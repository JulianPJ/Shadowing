import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import demo from '../../src/data/demo.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import { connect, seed } from '../helpers/retention-account';
import { createQuiz, newAttempt, updateAttempt } from '../../src/lib/quiz';
import { transcriptRevision } from '../../src/lib/transcript';
import type { Lesson } from '../../src/lib/types';
import authored from '../../src/data/demo-difficulty.json' with { type: 'json' };
import { createDifficultyAnalysis } from '../../src/lib/difficulty';
import type { BrowserContext } from '@playwright/test';
// These flows include local dictionary loading and hundreds of paginated vocabulary rows.
test.setTimeout(90_000);
async function cacheDifficulty(context: BrowserContext) {
  const analysis = await createDifficultyAnalysis(authored, demo as Lesson);
  await context.addInitScript(
    (analysis) => localStorage.setItem('hibiki:v1:difficulty:demo', JSON.stringify(analysis)),
    analysis,
  );
}
async function finish(page: Page) {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByTestId('transcript-13').click();
  await page.getByRole('button', { name: 'Finish practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lesson complete', exact: true })).toBeVisible();
}
test('uncached practice difficulty runs once at opening; completion starts no additional work', async ({
  page,
  context,
}) => {
  await connect(context, 'pro');
  const analysis = await createDifficultyAnalysis(authored, demo as Lesson),
    requests: string[] = [];
  await page.route(/\/api\/(quiz|difficulty|translate|shadowing\/)/, (route) => {
    requests.push(route.request().url());
    return route.fulfill(
      route.request().url().endsWith('/difficulty')
        ? { json: { analysis } }
        : { status: 500, json: { error: 'Unexpected inference' } },
    );
  });
  await page.goto('/practice/demo');
  await page.getByText('About this lesson’s difficulty', { exact: true }).click();
  await expect(page.getByTestId('lesson-difficulty').locator('dl')).toContainText('N5–N4');
  expect(requests).toHaveLength(1);
  await page.getByTestId('transcript-13').click();
  await page.getByRole('button', { name: 'Finish practice', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Lesson complete', exact: true })).toBeVisible();
  await page.getByText('About this lesson’s difficulty', { exact: true }).click();
  await expect(
    page
      .getByRole('region', { name: 'Lesson completion summary' })
      .getByTestId('lesson-difficulty')
      .locator('dl'),
  ).toContainText('N5–N4');
  expect(requests).toHaveLength(1);
});
for (const plan of ['free', 'pro'] as const)
  test(`${plan}: immediate unified completion omits unused results and makes no automatic inference`, async ({
    page,
    context,
  }) => {
    await connect(context, plan);
    await cacheDifficulty(context);
    if (plan === 'free') await page.setViewportSize({ width: 390, height: 844 });
    const inference: string[] = [];
    await page.route(/\/api\/(quiz|difficulty|translate|shadowing\/)/, (route) => {
      inference.push(route.request().url());
      return route.fulfill({ status: 500, json: { error: 'Unexpected inference' } });
    });
    await finish(page);
    const recap = page.getByRole('region', { name: 'Lesson completion summary' });
    await expect(recap).toContainText('You reached the end of this lesson.');
    await expect(recap).toContainText('No saved words due right now');
    await expect(recap.getByRole('heading', { name: 'Comprehension', exact: true })).toHaveCount(0);
    await expect(recap.locator('.shadowing-completion')).toHaveCount(0);
    await expect(recap.getByRole('heading', { name: 'Worth another listen' })).toHaveCount(0);
    await expect(recap.getByRole('link', { name: 'Choose next lesson' })).toBeVisible();
    await recap.getByText('Saved words and practice details', { exact: true }).click();
    if (plan === 'pro')
      await expect(recap.getByText('コーヒー', { exact: true })).toBeVisible({ timeout: 15000 });
    expect(inference).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/phase-a2-completion-${plan}.png`, fullPage: true });
    await recap.getByRole('button', { name: 'Practice again' }).click();
    await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
  });
test('completion combines cached match, completed quiz and explainable revisit links without inference', async ({
  page,
  context,
}) => {
  await connect(context, 'pro');
  await cacheDifficulty(context);
  const quiz = await createQuiz(questions, demo as Lesson),
    attempt = updateAttempt(
      newAttempt(quiz, demo),
      quiz,
      quiz.questions.map((q, i) =>
        i === 0 ? (q.correctIndex + 1) % q.options.length : q.correctIndex,
      ),
      true,
    );
  await context.addInitScript(
    ({ quiz, attempt, revision, section }) => {
      localStorage.setItem('hibiki:v1:quiz:demo', JSON.stringify(quiz));
      localStorage.setItem(
        `hibiki:v1:account:retention-pro:quiz-attempt:${quiz.id}`,
        JSON.stringify(attempt),
      );
      sessionStorage.setItem(
        'hibiki:shadowing:v1:account:retention-pro:demo',
        JSON.stringify({
          schemaVersion: 1,
          lessonId: 'demo',
          transcriptRevision: revision,
          sections: {
            [section]: {
              schemaVersion: 1,
              sectionId: section,
              score: 82,
              contentScore: 80,
              timingScore: 84,
              contentSimilarity: 0.8,
              timingSimilarity: 0.84,
              referenceDurationSeconds: 2,
              recordingDurationSeconds: 2,
              relativeSpeakingSpeed: 1,
              missing: [],
              additions: [],
              substitutions: [],
              recognizedText: '朝',
              normalization: 'orthographic',
              targetText: '朝',
              targetReading: 'あさ',
              recognizedReading: 'あさ',
              alignment: [],
              suggestions: [],
              attemptedAt: '2026-10-01T00:00:00.000Z',
            },
          },
        }),
      );
    },
    { quiz, attempt, revision: transcriptRevision(demo as Lesson), section: demo.segments[3].id },
  );
  const inference: string[] = [];
  page.on('request', (req) => {
    if (/\/api\/(quiz|difficulty|translate|shadowing\/)/.test(req.url())) inference.push(req.url());
  });
  await finish(page);
  const recap = page.getByRole('region', { name: 'Lesson completion summary' });
  await recap.getByText('Saved words and practice details', { exact: true }).click();
  await expect(recap.locator('.completion-comprehension')).toContainText(
    `${attempt.score} / ${attempt.totalQuestions}`,
  );
  await expect(recap).toContainText('Lowest Shadowing Match attempt');
  await expect(recap).toContainText('Missed in comprehension check');
  await expect(recap.locator('.completion-revisit li')).toHaveCount(2);
  expect(inference).toEqual([]);
});
test('tags are optional metadata: create Japanese, bulk tag, combine deck/tag filters, rename/delete without schedule loss', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 2);
  await page.goto('/dictionary');
  await expect(page.locator('.dictionary-entry')).toHaveCount(2);
  await page.getByText('Tags · describe your words', { exact: true }).click();
  await page.getByLabel('Tag name').fill('旅行');
  await page.getByRole('button', { name: 'Create tag', exact: true }).click();
  await expect.poll(() => remote.tags.length).toBe(1);
  await page
    .getByRole('combobox', { name: 'Manage tag', exact: true })
    .selectOption({ label: '旅行' });
  await page.getByLabel('Select 朝', { exact: true }).check();
  await page.getByRole('button', { name: 'Tag selected entries' }).click();
  await expect(page.getByRole('button', { name: 'Remove tag 旅行 from 朝' })).toBeVisible();
  await page.getByLabel('Filter by tag').selectOption({ label: '旅行' });
  await page.getByLabel('Filter by deck').selectOption('inbox');
  await expect(page.locator('.dictionary-entry')).toHaveCount(1);
  await expect(page.getByLabel('Select 朝', { exact: true })).not.toBeChecked();
  await page.getByText('Export saved words', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export filtered TSV' }).click();
  const tsv = await readFile((await (await download).path())!, 'utf8');
  expect(tsv).toContain('旅行');
  expect(tsv).toContain('Inbox');
  await page.getByLabel('Tag name').fill('旅');
  await page.getByRole('button', { name: 'Rename tag' }).click();
  await expect.poll(() => remote.tags[0].name).toBe('旅');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete tag', exact: true }).click();
  await expect.poll(() => remote.tags.length).toBe(0);
  expect(remote.entries).toHaveLength(2);
  expect(remote.review.cards).toHaveLength(2);
});
test('cursor UI and complete export reach old vocabulary; targeted review remains offline after unrelated pages', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  const old = remote.entries[0];
  old.id = 'word-0000';
  old.term = '古い語';
  old.createdAt = '2026-01-01T00:00:00.000Z';
  remote.review.cards[0].entryId = old.id;
  remote.review.memberships[0].entryId = old.id;
  for (let i = 1; i <= 805; i++)
    remote.entries.push({
      ...old,
      id: 'word-' + String(i).padStart(4, '0'),
      term: '語' + i,
      normalizedTerm: '語' + i,
      createdAt: '2026-10-01T00:00:00.000Z',
    });
  await page.goto('/review');
  await expect(page.getByRole('button', { name: 'Start review' })).toBeEnabled();
  expect(remote.queries.every((q) => q.startsWith('ids='))).toBe(true);
  await page.goto('/dictionary');
  await expect(page.locator('.dictionary-entry')).toHaveCount(100);
  for (let i = 0; i < 8; i++) {
    await page.getByRole('button', { name: 'Load more saved words', exact: true }).click();
    await expect(page.locator('.dictionary-entry')).toHaveCount(Math.min(806, (i + 2) * 100));
  }
  await expect(page.getByRole('heading', { name: '古い語', exact: true })).toBeVisible();
  await page.getByText('Export saved words', { exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export entire dictionary CSV' }).click();
  const csv = await readFile((await (await download).path())!, 'utf8');
  expect(csv).toContain('古い語');
  expect(csv).toContain('語805');
  expect(csv.split('\r\n')).toHaveLength(808);
  remote.offline = true;
  await page.goto('/review');
  await expect(page.getByRole('button', { name: 'Start review' })).toBeEnabled();
  await page.getByRole('button', { name: 'Start review' }).click();
  await expect(page.getByRole('heading', { name: '古い語', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show answer' }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
});

test('review keeps the full due queue and bounds each targeted hydration request', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 25);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '25 due now' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start review' })).toBeEnabled();
  expect(remote.queries.length).toBeGreaterThan(0);
  for (const query of remote.queries) {
    const params = new URLSearchParams(query);
    expect([...params.keys()]).toEqual(['ids']);
    expect(params.get('ids')!.split(',').length).toBeLessThanOrEqual(40);
  }
  remote.offline = true;
  await page.reload();
  await expect(page.getByRole('heading', { name: '25 due now' })).toBeVisible();
  await page.getByRole('button', { name: 'Start review' }).click();
  await expect(page.getByText(/0 ratings · 25 due now/)).toBeVisible();
});

test('account switching clears dictionary selections and tag forms while retaining isolated caches', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/dictionary');
  await expect(page.locator('.dictionary-entry')).toHaveCount(1);
  await page.getByLabel('Select 朝', { exact: true }).check();
  await page.getByText('Tags · describe your words', { exact: true }).click();
  await page.getByLabel('Tag name').fill('秘密のタグ');
  remote.entries = [];
  remote.tags = [];
  remote.review.cards = [];
  remote.review.memberships = [];
  await context.route('**/api/account/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: 'another-learner',
          email: 'another@example.com',
          name: 'Another learner',
          emailVerified: true,
          plan: 'free',
        },
        googleEnabled: false,
        emailEnabled: false,
      },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hibiki:v1:active-account') ?? 'null')),
    )
    .toBe('another-learner');
  await expect(page.locator('.dictionary-entry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export selected CSV' })).toHaveCount(0);
  await page.getByText('Tags · describe your words', { exact: true }).click();
  await expect(page.getByLabel('Tag name')).toHaveValue('');
  const records = await page.evaluate(() => ({
    previous: Object.keys(
      JSON.parse(
        localStorage.getItem('hibiki:v1:account:retention-free:dictionary:entries') ?? '{}',
      ).records ?? {},
    ),
    current: Object.keys(
      JSON.parse(
        localStorage.getItem('hibiki:v1:account:another-learner:dictionary:entries') ?? '{}',
      ).records ?? {},
    ),
  }));
  expect(records.previous).toEqual(['word-0']);
  expect(records.current).toEqual([]);
});
