import { expect, test } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { transcriptKey, transcriptRevision } from '../../src/lib/transcript';
import { createSession, sectionActivity } from '../../src/lib/learner/sessions';
import { lessonIdentity } from '../../src/lib/learner/constants';
import type { Lesson } from '../../src/lib/types';
import { mockProAccount, proStorageKey } from '../helpers/pro-account';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
});

test('queue persists, reorders, removes and carries a validated link into preparation', async ({
  page,
}) => {
  await page.route('**/api/prepare', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({ code: 'no-japanese-captions', error: 'Fixture has no captions.' }) + '\n',
    }),
  );
  await page.goto('/library');
  await expect(page.getByRole('heading', { name: 'Your lessons', exact: true })).toBeVisible();
  for (const [url, title] of [
    ['https://youtu.be/abcdefghijk?si=tracking', 'Morning video'],
    ['https://www.youtube.com/watch?v=lmnopqrstuv', 'Evening video'],
  ]) {
    await page.locator('.queue-form').getByLabel('Video link', { exact: true }).fill(url);
    await page.getByLabel('Title (optional)').fill(title);
    await page.getByRole('button', { name: 'Add to queue' }).click();
  }
  await page.getByRole('button', { name: 'Move Evening video earlier' }).click();
  await expect(page.locator('.library-queue li').first()).toContainText('Evening video');
  await page.reload();
  await expect(page.locator('.library-queue li')).toHaveCount(2);
  await page
    .locator('.library-queue li')
    .filter({ hasText: 'Morning video' })
    .getByRole('link', { name: 'Prepare' })
    .click();
  await expect(page.getByLabel('Paste a Japanese video link')).toHaveValue(
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Close import', exact: true }).click();
  await page.getByRole('link', { name: 'Back to Discover', exact: false }).click();
  await page
    .getByRole('navigation', { name: 'Browse' })
    .getByRole('link', { name: 'Library', exact: true })
    .click();
  await page.getByRole('button', { name: 'Remove Evening video from queue' }).click();
  await expect(page.locator('.library-queue li')).toHaveCount(1);
});

test('library completion is revision-specific and deliberately saved lessons survive navigation', async ({
  page,
}) => {
  const lessons = [
    { ...demo, id: 'library-one', title: 'One morning' },
    { ...demo, id: 'library-two', title: 'Two mornings' },
  ] as Lesson[];
  await page.addInitScript(
    ({ lessons, revision }) => {
      if (localStorage.getItem('library-seeded')) return;
      localStorage.setItem('library-seeded', 'yes');
      lessons.forEach((lesson) =>
        localStorage.setItem(`hibiki:v1:lesson:${lesson.id}`, JSON.stringify(lesson)),
      );
      localStorage.setItem(
        'hibiki:v1:history',
        JSON.stringify(
          lessons.map((lesson, i) => ({ lesson, index: i + 1, updatedAt: Date.now() - i })),
        ),
      );
      localStorage.setItem(
        'hibiki:v1:completion:library-two',
        JSON.stringify({ transcript: revision, completedAt: new Date().toISOString() }),
      );
    },
    { lessons, revision: transcriptRevision(lessons[1]) },
  );
  await page.goto('/library');
  await page.getByRole('button', { name: 'Continue watching', exact: true }).click();
  await expect(page.locator('.library-lesson-list')).toContainText('One morning');
  await expect(page.locator('.library-lesson-list')).not.toContainText('Two mornings');
  await page.getByRole('button', { name: 'Save One morning to library' }).click();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('.library-lesson-list li')).toHaveCount(1);
  await page.reload();
  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page.locator('.library-lesson-list')).toContainText('Two mornings');
  await page.getByRole('link', { name: 'Hibiki home' }).click();
  await expect(page.locator('.library-preview')).toContainText('One morning');
  await expect(page.locator('.library-preview')).not.toContainText('Two mornings');
});

test('anonymous queue and goals stay separate from the signed-in account', async ({ page }) => {
  await page.addInitScript(
    ({ goalKey }) => {
      localStorage.setItem(
        'hibiki:v1:library:data',
        JSON.stringify({
          version: 1,
          pinned: [],
          queue: [
            {
              id: 'anon',
              url: 'https://www.youtube.com/watch?v=abcdefghijk',
              title: 'Anonymous queue',
              addedAt: new Date().toISOString(),
            },
          ],
        }),
      );
      localStorage.setItem('hibiki:v1:goal:daily', JSON.stringify({ version: 1, minutes: 20 }));
      localStorage.setItem(goalKey, JSON.stringify({ version: 1, minutes: 3 }));
    },
    { goalKey: proStorageKey('goal:daily') },
  );
  await mockProAccount(page);
  await page.route('**/api/knowledge*', (route) =>
    route.fulfill({ json: { records: [], nextCursor: null } }),
  );
  await page.goto('/library');
  await expect(page.getByRole('link', { name: 'Profile', exact: true })).toBeVisible();
  await expect(page.locator('.library-queue')).toHaveCount(0);
  await page.getByRole('link', { name: 'Profile', exact: true }).click();
  await expect(page.locator('.daily-goal')).toContainText('/ 3 minutes today');
  await expect(page.locator('.daily-goal')).not.toContainText('/ 20 minutes today');
});

test('weekly report uses genuine local evidence and a calm goal survives reload on mobile', async ({
  page,
}) => {
  const now = new Date().toISOString();
  const session = createSession(
    lessonIdentity(demo as Lesson, await transcriptKey(demo as Lesson)),
    now,
  );
  session.activeSeconds = 360;
  session.activeByDay = { [now.slice(0, 10)]: 360 };
  session.sections = [{ ...sectionActivity(demo.segments[0]), replays: 2, recordingAttempts: 1 }];
  await page.addInitScript(
    ({ session, now }) => {
      if (localStorage.getItem('report-seeded')) return;
      localStorage.setItem('report-seeded', 'yes');
      session.localActiveByDay = { [new Date().toLocaleDateString('en-CA')]: 360 };
      localStorage.setItem(
        'hibiki:v1:learner-history',
        JSON.stringify({
          schemaVersion: 1,
          migrationVersion: 1,
          sessions: [session],
          archives: [],
          difficulties: [],
        }),
      );
      localStorage.setItem(
        'hibiki:v1:review:history',
        JSON.stringify([
          { operationId: 'report-a', entryId: 'word-a', grade: 'good', reviewedAt: now },
          { operationId: 'report-b', entryId: 'word-b', grade: 'again', reviewedAt: now },
        ]),
      );
      localStorage.setItem(
        'hibiki:v1:knowledge:records',
        JSON.stringify([{ lemma: '朝', reading: 'アサ', state: 'known', updatedAt: now }]),
      );
    },
    { session, now },
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/progress');
  await expect(page.locator('.weekly-metrics')).toContainText('Minutes practised6');
  await expect(page.locator('.weekly-metrics')).toContainText('Sections revisited1');
  await expect(page.locator('.weekly-metrics')).toContainText('Words known1');
  await expect(page.locator('.weekly-metrics')).toContainText('Review recall50%');
  await expect(page.getByRole('heading', { name: 'This week', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set a daily goal' }).click();
  await expect(page.getByRole('progressbar', { name: 'Daily practice goal' })).toHaveAttribute(
    'value',
    '300',
  );
  await expect(page.locator('.daily-goal')).toContainText('You made room for Japanese today.');
  await page.reload();
  await expect(page.locator('.daily-goal')).toContainText('6 / 5 minutes today');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/weekly-report-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Turn off daily goal' }).click();
  await expect(page.getByRole('button', { name: 'Set a daily goal' })).toBeVisible();
});
