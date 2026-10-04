import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import { createQuiz, transcriptRevision } from '../../src/lib/quiz';
import type { Lesson } from '../../src/lib/types';

async function finishLesson(page: Page, continuous = false) {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Take comprehension check' })).toHaveCount(0);
  if (continuous) await page.getByRole('button', { name: 'Continuous', exact: true }).click();
  await page.getByTestId(`transcript-${demo.segments.length - 1}`).click();
  // Let the final short section end naturally: seeking while play() is pending
  // aborts native playback in Chromium and tests a different recovery path.
  if (!continuous) {
    await expect(page.getByRole('button', { name: 'Finish practice' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish practice' }).click();
  }
  await expect(page.getByRole('button', { name: 'Take comprehension check' })).toBeVisible();
}
async function mockQuiz(page: Page) {
  const quiz = await createQuiz(questions, demo as Lesson);
  let calls = 0;
  await page.route('**/api/quiz', (route) => {
    calls++;
    return route.fulfill({ json: { quiz } });
  });
  return { quiz, calls: () => calls };
}
test('complete lesson, answer, explain, replay bounded evidence, return, finish, persist and reuse', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const mock = await mockQuiz(page);
  await finishLesson(page);
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.getByRole('heading', { name: questions.questions[0].question })).toBeVisible();
  await page.getByRole('group', { name: 'Answer options' }).getByRole('button').nth(0).click();
  await expect(page.locator('.quiz-feedback')).toContainText('Correct.');
  await expect(page.locator('.quiz-feedback')).toContainText(questions.questions[0].explanation);
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments.at(-1)!.japanese);
  await page.getByRole('button', { name: 'Replay relevant section' }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeLessThan(2);
  await expect(page.locator('.evidence-banner')).toBeVisible();
  await page
    .locator('.evidence-banner')
    .getByRole('button', { name: 'Return to question' })
    .click();
  await expect(page.locator('.quiz-option.chosen')).toContainText('朝の過ごし方');
  await expect(page.locator('.quiz-feedback')).toContainText('Correct.');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments.at(-1)!.japanese);
  await page.getByRole('button', { name: 'Next question', exact: true }).click();
  await page.getByRole('group', { name: 'Answer options' }).getByRole('button').nth(0).click();
  await expect(page.locator('.quiz-feedback')).toContainText('Not quite.');
  await expect(page.locator('.quiz-option.correct')).toContainText('七時ごろ');
  // A saved draft survives navigation/reload and never regenerates the quiz.
  await page.reload();
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.getByRole('heading', { name: questions.questions[2].question })).toBeVisible();
  for (let i = 2; i < questions.questions.length; i++) {
    await page
      .getByRole('group', { name: 'Answer options' })
      .getByRole('button')
      .nth(questions.questions[i].correctIndex)
      .click();
    if (i === 2) {
      // Multi-segment replay crosses shadowing boundaries and stops at the evidence end.
      await page.getByRole('button', { name: 'Replay relevant section' }).click();
      await expect
        .poll(() =>
          page
            .locator('video')
            .evaluate(
              (v: HTMLVideoElement) =>
                !v.seeking &&
                !v.paused &&
                v.readyState >= 3 &&
                v.currentTime >= 12.4 &&
                v.currentTime < 18,
            ),
        )
        .toBe(true);
      await page.locator('video').evaluate((v: HTMLVideoElement) => {
        v.currentTime = 27.5;
      });
      await expect
        .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused))
        .toBe(true);
      expect(
        await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime),
      ).toBeLessThan(28);
      await page
        .locator('.evidence-banner')
        .getByRole('button', { name: 'Return to question' })
        .click();
    }
    if (i < questions.questions.length - 1)
      await page.getByRole('button', { name: 'Next question', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Finish comprehension check' }).click();
  await expect(page.locator('.quiz-summary')).toContainText('4 / 5 correct');
  await expect(page.locator('.quiz-summary')).toContainText('Result saved');
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hibiki:v1:quiz-attempts')!),
  );
  expect(history).toHaveLength(1);
  expect(history[0]).toMatchObject({
    lessonId: 'demo',
    quizAttempted: true,
    score: 4,
    totalQuestions: 5,
  });
  expect(history[0].completedAt).toBeTruthy();
  expect(history[0].results).toHaveLength(5);
  await page.reload();
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.locator('.quiz-summary')).toContainText('4 / 5 correct');
  expect(mock.calls()).toBe(1);
  expect(errors).toEqual([]);
});
test('continuous completion opens optional quiz with first-class mobile layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockQuiz(page);
  await finishLesson(page, true);
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await page.getByRole('group', { name: 'Answer options' }).getByRole('button').nth(0).click();
  await expect(page.locator('.quiz-feedback')).toContainText('Correct.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const options = await page
    .locator('.quiz-option')
    .evaluateAll((elements) => elements.map((e) => e.getBoundingClientRect().height));
  expect(options.every((height) => height >= 44)).toBe(true);
  await page.screenshot({ path: 'artifacts/quiz-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Replay relevant section' }).click();
  await page
    .locator('.evidence-banner')
    .getByRole('button', { name: 'Return to question' })
    .click();
  await expect(page.locator('.quiz-option.chosen')).toBeVisible();
});
test('provider failure and malformed output offer retry without blocking a completed lesson', async ({
  page,
}) => {
  let calls = 0;
  const quiz = await createQuiz(questions, demo as Lesson);
  await page.route('**/api/quiz', (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 503, json: { error: 'The check is temporarily unavailable.' } }
        : calls === 2
          ? { json: { quiz: { ...quiz, questions: [] } } }
          : { json: { quiz } },
    );
  });
  await finishLesson(page);
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.locator('#lesson-quiz [role="alert"]')).toContainText(
    'temporarily unavailable',
  );
  await page.getByRole('button', { name: 'Back to practice' }).click();
  await page.getByRole('button', { name: 'Practice again' }).click();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.locator('#lesson-quiz [role="alert"]')).toContainText('reliable check');
  await page.getByRole('button', { name: 'Retry comprehension check' }).click();
  await expect(page.getByRole('heading', { name: questions.questions[0].question })).toBeVisible();
});
test('real demo API generates a quiz without provider configuration', async ({ page }) => {
  await page.addInitScript(
    ({ revision }) =>
      localStorage.setItem('hibiki:v1:completion:demo', JSON.stringify({ transcript: revision })),
    { revision: transcriptRevision(demo as Lesson) },
  );
  await page.goto('/practice/demo');
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await expect(page.getByRole('heading', { name: questions.questions[0].question })).toBeVisible();
});
