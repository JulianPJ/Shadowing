import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import authoredDifficulty from '../../src/data/demo-difficulty.json' with { type: 'json' };
import { createQuiz, transcriptKey } from '../../src/lib/quiz';
import { createDifficultyAnalysis } from '../../src/lib/difficulty';
import { createSession, lessonIdentity } from '../../src/lib/learner-progress';
import type { Lesson } from '../../src/lib/types';

async function openDemo(page: Page) {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
}
async function history(page: Page) {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem('hibiki:v1:learner-history') ?? '{"sessions":[]}'),
  );
}
async function progress(page: Page) {
  await page.getByRole('link', { name: 'Progress', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your progress', exact: true })).toBeVisible();
}

test('progress observes the latest bookmark state after a burst of writes in another tab', async ({
  page,
  context,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Replay R' }).click();
  await progress(page);
  const peer = await context.newPage();
  await peer.goto('/practice/demo');
  await expect(peer.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await peer.evaluate(
    (ids) => {
      for (let n = 0; n < 30; n++) {
        localStorage.setItem('hibiki:v1:favorites:demo', JSON.stringify(n % 2 ? [] : [ids[0]]));
      }
      localStorage.setItem('hibiki:v1:favorites:demo', JSON.stringify(ids));
    },
    demo.segments.slice(0, 2).map((s) => s.id),
  );
  await expect(page.locator('.progress-habits')).toContainText('Saved sections2');
  await peer.close();
});
test('empty progress is calm, mobile and does not fabricate lesson activity', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/progress');
  await expect(page.getByRole('heading', { name: 'A little practice starts here.' })).toBeVisible();
  await expect(page.locator('.progress-intro')).toContainText('Saved on this device');
  expect((await history(page)).sessions).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('practice captures deliberate replay, reveal and bookmark, resumes on reload and links back', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await openDemo(page);
  await page.getByRole('button', { name: 'Reveal translation T' }).click();
  await page.getByRole('button', { name: 'Hide translation T' }).click();
  await page.getByRole('button', { name: 'Save this section for practice' }).click();
  await page.getByRole('button', { name: 'Replay R' }).click();
  await page.getByTestId('transcript-1').click(); // navigation isn't replay
  await expect
    .poll(
      async () =>
        (await history(page)).sessions.filter((s: { origin: string }) => s.origin === 'practice')
          .length,
    )
    .toBe(1);
  const first = (await history(page)).sessions.find(
    (s: { origin: string }) => s.origin === 'practice',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.locator('body').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('r');
  await progress(page);
  const after = await history(page);
  const sessions = after.sessions.filter((s: { origin: string }) => s.origin === 'practice');
  expect(sessions).toHaveLength(1);
  expect(sessions[0].id).toBe(first.id);
  await expect(page.locator('.progress-habits')).toContainText('Explicit section replays2');
  await expect(page.locator('.progress-habits')).toContainText(
    'Translation reveals1 · 1 sections helped',
  );
  await expect(page.locator('.progress-habits')).toContainText('Saved sections1');
  await expect(page.locator('.attention-reasons').first()).toContainText('Saved section');
  expect(sessions[0].activeSeconds).toBeGreaterThan(0);
  await page.locator('.progress-list a').first().click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await page.getByTestId('transcript-0').click();
  await page.getByRole('button', { name: 'Unsave this section' }).click();
  await progress(page);
  await expect(page.locator('.progress-habits')).toContainText('Saved sections0');
  expect(errors).toEqual([]);
});
test('recording attempts capture no audio and current progress is usable on mobile', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  await page.getByRole('button', { name: 'Record yourself' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await page.getByRole('button', { name: 'Record again' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await progress(page);
  await expect(page.locator('.progress-habits')).toContainText('Recording attempts2');
  await expect(page.locator('.attention-reasons')).toContainText('2 recording attempts');
  const serialized = JSON.stringify(await history(page));
  expect(serialized).not.toContain('blob:');
  expect(serialized).not.toContain('japanese');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/progress-mobile.png', fullPage: true });
});
test('completion and quiz retakes feed existing comprehension history; evidence replay stays distinct', async ({
  page,
}) => {
  const quiz = await createQuiz(questions, demo as Lesson);
  await page.route('**/api/quiz', (route) => route.fulfill({ json: { quiz } }));
  await openDemo(page);
  await page.getByTestId(`transcript-${demo.segments.length - 1}`).click();
  await page.getByRole('button', { name: 'Finish practice' }).click();
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await page.getByRole('button', { name: 'Try the check again' }).click();
    for (let i = 0; i < quiz.questions.length; i++) {
      const selected =
        attempt === 0 && i === 0
          ? (quiz.questions[i].correctIndex + 1) % 4
          : quiz.questions[i].correctIndex;
      await page
        .getByRole('group', { name: 'Answer options' })
        .getByRole('button')
        .nth(selected)
        .click();
      if (attempt === 0 && i === 0) {
        await page.getByRole('button', { name: 'Replay relevant section' }).click();
        await page
          .locator('.evidence-banner')
          .getByRole('button', { name: 'Return to question' })
          .click();
      }
      if (i < quiz.questions.length - 1)
        await page.getByRole('button', { name: 'Next question', exact: true }).click();
    }
    await page.getByRole('button', { name: 'Finish comprehension check' }).click();
  }
  await progress(page);
  await expect(page.locator('.progress-summary')).toContainText('1 completed');
  await expect(page.locator('.progress-summary')).toContainText('9 / 10 correct');
  await expect(page.locator('.progress-habits')).toContainText('Explicit section replays0');
  await expect(page.locator('.progress-panel')).toContainText(['Quiz evidence replays: 1.']);
  await expect(page.locator('.attention-reasons')).toContainText('1 missed question');
});
test('later visits create independent sessions and metadata survives missing lesson content', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Replay R' }).click();
  await progress(page);
  await page.evaluate(() => {
    const h = JSON.parse(localStorage.getItem('hibiki:v1:learner-history')!);
    for (const s of h.sessions) {
      if (s.origin === 'practice') {
        s.startedAt = '2026-01-01T00:00:00.000Z';
        s.updatedAt = s.startedAt;
        s.endedAt = s.startedAt;
      }
    }
    localStorage.setItem('hibiki:v1:learner-history', JSON.stringify(h));
  });
  await page.goto('/practice/demo');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await progress(page);
  expect(
    (await history(page)).sessions.filter((s: { origin: string }) => s.origin === 'practice'),
  ).toHaveLength(2);
  const missing = { ...demo, id: 'no-longer-available', title: 'Earlier practice' } as Lesson;
  const s = createSession(
    lessonIdentity(missing, await transcriptKey(missing)),
    new Date().toISOString(),
  );
  s.completed = true;
  await page.evaluate((s) => {
    const h = JSON.parse(localStorage.getItem('hibiki:v1:learner-history')!);
    h.sessions.push(s);
    localStorage.setItem('hibiki:v1:learner-history', JSON.stringify(h));
  }, s);
  await page.reload();
  await expect(page.locator('.progress-list')).toContainText(['Earlier practice']);
  await expect(page.getByRole('link', { name: 'Earlier practice' })).toHaveCount(0);
});
test('five practised unique analyzed lessons produce typical content and later analysis joins history', async ({
  page,
}) => {
  const lessons = Array.from(
    { length: 5 },
    (_, i) => ({ ...demo, id: `profile-${i}`, title: `Content lesson ${i}` }) as Lesson,
  );
  const sessions = await Promise.all(
    lessons.map(async (l) => {
      const s = createSession(lessonIdentity(l, await transcriptKey(l)), new Date().toISOString());
      s.completed = true;
      return s;
    }),
  );
  const analyses = await Promise.all(
    lessons.map((l) => createDifficultyAnalysis(authoredDifficulty, l)),
  );
  await page.addInitScript(
    ({ lessons, sessions, analyses }) => {
      if (localStorage.getItem('seeded')) return;
      localStorage.setItem('seeded', 'yes');
      localStorage.setItem(
        'hibiki:v1:learner-history',
        JSON.stringify({
          schemaVersion: 1,
          migrationVersion: 1,
          sessions,
          archives: [],
          difficulties: [],
        }),
      );
      lessons.forEach((l, i) => {
        localStorage.setItem(`hibiki:v1:lesson:${l.id}`, JSON.stringify(l));
        if (i < 4)
          localStorage.setItem(`hibiki:v1:difficulty:${l.id}`, JSON.stringify(analyses[i]));
      });
    },
    { lessons, sessions, analyses },
  );
  await page.goto('/progress');
  await expect(page.locator('.progress-main')).toContainText('at least five different lessons');
  await page.route('**/api/difficulty', (route) =>
    route.fulfill({ json: { analysis: analyses[4] } }),
  );
  await page.goto(`/practice/${lessons[4].id}`);
  await page.getByRole('button', { name: 'Estimate difficulty', exact: true }).click();
  await expect(page.locator('.difficulty-summary')).toBeVisible();
  await progress(page);
  await expect(page.locator('.content-range')).toHaveText(
    `Typical content: ${analyses[0].overall.jlptMin}–${analyses[0].overall.jlptMax}`,
  );
});
test('checkpointing is incremental, bounded and excludes a quiz/analysis wait', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    let count = 0;
    Object.defineProperty(window, '__progressWrites', { get: () => count });
    Storage.prototype.setItem = function (k, v) {
      if (k === 'hibiki:v1:learner-history') count++;
      return original.call(this, k, v);
    };
  });
  await openDemo(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await history(page)).sessions.find((s: { origin: string }) => s.origin === 'practice')
          ?.activeSeconds ?? 0,
    )
    .toBeGreaterThan(0);
  const before = await page.evaluate(
    () => (window as unknown as { __progressWrites: number }).__progressWrites,
  );
  await page.waitForTimeout(16000);
  const h = await history(page);
  expect(
    h.sessions.find((s: { origin: string }) => s.origin === 'practice').activeSeconds,
  ).toBeGreaterThan(10);
  const after = await page.evaluate(
    () => (window as unknown as { __progressWrites: number }).__progressWrites,
  );
  expect(after - before).toBeLessThanOrEqual(2);
  await page.route('**/api/difficulty', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5000));
    await route.fulfill({ status: 503, json: { error: 'Unavailable' } });
  });
  await page.getByRole('button', { name: 'Estimate difficulty', exact: true }).click();
  const seconds = (await history(page)).sessions.find(
    (s: { origin: string }) => s.origin === 'practice',
  ).activeSeconds;
  await expect(page.getByRole('button', { name: 'Retry difficulty analysis' })).toBeVisible();
  await progress(page);
  const final = (await history(page)).sessions.find(
    (s: { origin: string }) => s.origin === 'practice',
  ).activeSeconds;
  expect(final - seconds).toBeLessThan(3);
});
test('blocked localStorage warns without breaking lesson, recording controls or visit progress', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Blocked', 'QuotaExceededError');
    };
    Storage.prototype.getItem = () => {
      throw new DOMException('Blocked', 'SecurityError');
    };
  });
  await openDemo(page);
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await expect(
    page.getByText('Progress for this visit may not be saved.', { exact: true }),
  ).toBeVisible();
  await progress(page);
  await expect(page.locator('.progress-habits')).toContainText('Explicit section replays1');
});
