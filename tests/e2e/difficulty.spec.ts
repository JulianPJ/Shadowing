import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import demo from '../../src/data/demo.json' with { type: 'json' };
import authored from '../../src/data/demo-difficulty.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import { createDifficultyAnalysis } from '../../src/lib/difficulty';
import { createQuiz, transcriptRevision } from '../../src/lib/quiz';
import type { Lesson } from '../../src/lib/types';
import { mockProAccount, proStorageKey } from '../helpers/pro-account';

async function openDemo(page: Page) {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
}
test('automatic analysis shows compact classifications for all five dimensions and reuses reload cache', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const analysis = await createDifficultyAnalysis(authored, demo as Lesson);
  let calls = 0;
  await page.route('**/api/difficulty', (route) => {
    calls++;
    return route.fulfill({ json: { analysis } });
  });
  await openDemo(page);
  const card = page.getByTestId('lesson-difficulty');
  await expect(card.locator('dl')).toContainText('N5–N4');
  expect(calls).toBe(1);
  for (const dimension of ['Approx. level', 'Vocabulary', 'Grammar', 'Speech', 'Conversation'])
    await expect(card.getByText(dimension, { exact: true })).toBeVisible();
  await expect(card).toContainText('Classification uses the full Japanese transcript');
  await page.reload();
  await expect(card.locator('dl')).toContainText('N5–N4');
  expect(calls).toBe(1);
  expect(errors).toEqual([]);
});
test('API failure and malformed result can be retried while playback and the completed quiz still work', async ({
  page,
}) => {
  await mockProAccount(page);
  const analysis = await createDifficultyAnalysis(authored, demo as Lesson);
  let calls = 0;
  await page.addInitScript(
    ({ key, revision }) =>
      localStorage.setItem(key, JSON.stringify({ transcript: revision })),
    { key: proStorageKey('completion:demo'), revision: transcriptRevision(demo as Lesson) },
  );
  await page.route('**/api/difficulty', (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 503, json: { code: 'unavailable', error: 'SECRET provider internals' } }
        : calls === 2
          ? { json: { analysis: { ...analysis, overall: { ...analysis.overall, jlptMin: 'N6' } } } }
          : { json: { analysis } },
    );
  });
  const quiz = await createQuiz(questions, demo as Lesson);
  await page.route('**/api/quiz', (route) => route.fulfill({ json: { quiz } }));
  await openDemo(page);
  const card = page.getByTestId('lesson-difficulty');
  await expect(card.getByRole('alert')).toContainText('unavailable');
  await expect(card).not.toContainText('SECRET');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await card.getByRole('button', { name: 'Retry difficulty analysis' }).click();
  await expect(card.getByRole('alert')).toContainText('reliable difficulty estimate');
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.getByRole('heading', { name: questions.questions[0].question })).toBeVisible();
  await card.getByRole('button', { name: 'Retry difficulty analysis' }).click();
  await expect(card.locator('dl')).toContainText('N5–N4');
  expect(calls).toBe(3);
});
test('real authored demo route works without provider credentials and fits mobile', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  const card = page.getByTestId('lesson-difficulty');
  await expect(card.locator('dl')).toContainText('N5–N4');
  await expect(card).toContainText('Classification uses the full Japanese transcript');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'artifacts/difficulty-mobile.png', fullPage: true });
});
test('editing the same stored lesson invalidates cached analysis and generates for the new transcript', async ({
  page,
}) => {
  const custom = {
    ...demo,
    id: 'difficulty-custom',
    source: 'upload' as const,
    mediaUrl: undefined,
  };
  const old = await createDifficultyAnalysis(authored, custom);
  let calls = 0;
  await page.addInitScript(
    ({ custom, old }) => {
      if (!localStorage.getItem('hibiki:v1:lesson:difficulty-custom')) {
        localStorage.setItem('hibiki:v1:lesson:difficulty-custom', JSON.stringify(custom));
        localStorage.setItem('hibiki:v1:difficulty:difficulty-custom', JSON.stringify(old));
      }
    },
    { custom, old },
  );
  await page.route('**/api/difficulty', async (route) => {
    calls++;
    const input = route.request().postDataJSON().lesson;
    return route.fulfill({ json: { analysis: await createDifficultyAnalysis(authored, input) } });
  });
  await page.goto('/practice/difficulty-custom');
  await expect(page.getByTestId('lesson-difficulty').locator('dl')).toContainText('N5–N4');
  expect(calls).toBe(0);
  await page.evaluate(() => {
    const value = JSON.parse(localStorage.getItem('hibiki:v1:lesson:difficulty-custom')!);
    value.segments[0].japanese += '静かな朝です。';
    localStorage.setItem('hibiki:v1:lesson:difficulty-custom', JSON.stringify(value));
  });
  await page.reload();
  await expect(page.getByTestId('lesson-difficulty').locator('dl')).toContainText('N5–N4');
  expect(calls).toBe(1);
  const next = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hibiki:v1:difficulty:difficulty-custom')!),
  );
  expect(next.transcriptKey).not.toBe(old.transcriptKey);
});
test('pending analysis leaves shadowing controls usable and storage failure retains the current result', async ({
  page,
}) => {
  const analysis = await createDifficultyAnalysis(authored, demo as Lesson);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/difficulty', async (route) => {
    await gate;
    await route.fulfill({ json: { analysis } });
  });
  await openDemo(page);
  await page.evaluate(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError');
    };
  });
  await expect(page.getByTestId('lesson-difficulty').getByRole('status')).toContainText(
    'keep practicing',
  );
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  release();
  await expect(page.getByTestId('lesson-difficulty').locator('dl')).toContainText('N5–N4');
  await expect(page.getByTestId('lesson-difficulty').getByRole('status')).toContainText(
    'could not save',
  );
});
test('a short transcript exposes no fabricated pace and does not request AI', async ({ page }) => {
  const short = {
    ...demo,
    id: 'difficulty-short',
    source: 'upload',
    segments: [{ id: 'tiny', start: 0, end: 2, japanese: 'こんにちは。' }],
  };
  let calls = 0;
  await page.route('**/api/difficulty', (route) => {
    calls++;
    return route.abort();
  });
  await page.addInitScript(
    (short) => localStorage.setItem('hibiki:v1:lesson:difficulty-short', JSON.stringify(short)),
    short,
  );
  await page.goto('/practice/difficulty-short');
  const card = page.getByTestId('lesson-difficulty');
  await expect(card).toContainText('Not enough timing data');
  await expect(
    card.getByRole('button', { name: 'Estimate difficulty', exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
});
test('reattaching local media preserves a pending analysis for the unchanged transcript', async ({
  page,
}) => {
  const custom = {
    ...demo,
    id: 'difficulty-reattach',
    source: 'upload' as const,
    mediaUrl: undefined,
  };
  const analysis = await createDifficultyAnalysis(authored, custom);
  await page.addInitScript(
    (custom) =>
      localStorage.setItem('hibiki:v1:lesson:difficulty-reattach', JSON.stringify(custom)),
    custom,
  );
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/difficulty', async (route) => {
    await gate;
    await route.fulfill({ json: { analysis } });
  });
  await page.goto('/practice/difficulty-reattach');
  await expect(page.getByTestId('lesson-difficulty').getByRole('status')).toContainText(
    'keep practicing',
  );
  await page.getByLabel('Reattach media').setInputFiles(path.resolve('public/demo.mp4'));
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  release();
  await expect(page.getByTestId('lesson-difficulty').locator('dl')).toContainText('N5–N4');
});
