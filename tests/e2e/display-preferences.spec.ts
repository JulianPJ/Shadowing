import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import { createQuiz, transcriptRevision } from '../../src/lib/quiz';
import type { Lesson } from '../../src/lib/types';

async function open(page: Page) {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: /^(Listen|Play)$/ })).toBeEnabled();
}
const studio = (page: Page) => page.getByRole('button', { name: 'Studio Mode', exact: true });
const furigana = (page: Page) => page.getByRole('button', { name: 'Furigana', exact: true });
async function sourceText(page: Page, selector: string) {
  return page.locator(selector).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('rt').forEach((rt) => rt.remove());
    return copy.textContent;
  });
}

test('display defaults, lazy assets, Studio playback continuity, navigation and preference migration', async ({
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/furigana/')) assets.push(request.url());
  });
  await page.addInitScript(() => {
    if (!localStorage.getItem('hibiki:v1:preferences'))
      localStorage.setItem(
        'hibiki:v1:preferences',
        JSON.stringify({ mode: 'continuous', speed: 0.75, translation: true }),
      );
  });
  await open(page);
  await expect(studio(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(furigana(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('ruby')).toHaveCount(0);
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('0.75');
  const offset = page.getByRole('button', { name: 'Reset playback timing offset' });
  await expect(offset).toHaveText('0 ms');
  for (let i = 0; i < 7; i++)
    await page
      .getByRole('button', { name: 'Shift playback timing 50 milliseconds later' })
      .click();
  await expect(offset).toHaveText('+350 ms');
  await expect(page.getByRole('button', { name: 'Continuous', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  expect(assets).toEqual([]);
  await page.getByRole('button', { name: 'Save this section for practice' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.3);
  const before = await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.dataset.mounted = 'same-player';
    return v.currentTime;
  });
  await studio(page).click();
  await expect(page.locator('.practice-main')).toHaveClass(/studio-mode/);
  await expect(offset).toBeVisible();
  await expect(offset).toHaveText('+350 ms');
  const after = await page.locator('video').evaluate((v: HTMLVideoElement) => ({
    time: v.currentTime,
    paused: v.paused,
    speed: v.playbackRate,
    mounted: v.dataset.mounted,
  }));
  expect(after.time).toBeGreaterThanOrEqual(before);
  expect(after.time - before).toBeLessThan(1);
  expect(after).toMatchObject({ paused: false, speed: 0.75, mounted: 'same-player' });
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
  await furigana(page).click();
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
  expect(
    await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeGreaterThanOrEqual(after.time);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveAccessibleName(
    demo.segments[1].japanese,
  );
  await page.getByRole('button', { name: 'Previous section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveAccessibleName(
    demo.segments[0].japanese,
  );
  await page.getByRole('button', { name: /^Replay(?: R)?$/ }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(2);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
  await studio(page).click();
  await expect(page.locator('.practice-main')).not.toHaveClass(/studio-mode/);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime)).toBe(paused);
  await expect(page.getByRole('button', { name: 'Unsave this section' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await studio(page).click();
  // Desktop Studio Mode hides the global header; its breadcrumb remains available.
  await page.getByRole('link', { name: 'Your practice', exact: true }).click();
  await page.goto('/practice/demo');
  await expect(studio(page)).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(studio(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('0.75');
  await expect(page.getByRole('button', { name: 'Reset playback timing offset' })).toHaveText(
    '+350 ms',
  );
});

test('ruby on current/transcript, canonical search/copy bases/storage and preference persistence', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await open(page);
  const canonical = await page.evaluate(() => localStorage.getItem('hibiki:v1:lesson:demo'));
  await furigana(page).click();
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
  await expect(page.getByTestId('current-japanese')).toHaveAccessibleName(
    demo.segments[0].japanese,
  );
  await expect(page.locator('[data-testid="transcript-0"] ruby')).not.toHaveCount(0);
  expect(await sourceText(page, '#current-japanese')).toBe(demo.segments[0].japanese);
  expect(
    await page.locator('#current-japanese').evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      const copied = selection.toString();
      selection.removeAllRanges();
      return copied;
    }),
  ).toBe(demo.segments[0].japanese);
  await expect(page.locator('#current-japanese rt').filter({ hasText: 'きょう' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search Japanese transcript' }).fill('こうえん');
  await expect(page.locator('.transcript-row')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search Japanese transcript' }).fill('公園');
  await expect(page.locator('.transcript-row')).toHaveCount(2);
  await furigana(page).click();
  await expect(page.locator('ruby')).toHaveCount(0);
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
  expect(await page.evaluate(() => localStorage.getItem('hibiki:v1:lesson:demo'))).toBe(canonical);
  await furigana(page).click();
  await page.reload();
  await expect(furigana(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
  expect(errors).toEqual([]);
});

test('Studio and Furigana preserve quiz answers, difficulty, identity and bounded evidence replay', async ({
  page,
}) => {
  const quiz = await createQuiz(questions, demo as Lesson);
  let calls = 0;
  await page.route('**/api/quiz', (route) => {
    calls++;
    return route.fulfill({ json: { quiz } });
  });
  await page.addInitScript(
    ({ revision }) =>
      localStorage.setItem('hibiki:v1:completion:demo', JSON.stringify({ transcript: revision })),
    { revision: transcriptRevision(demo as Lesson) },
  );
  await open(page);
  await page.getByRole('button', { name: 'Estimate difficulty' }).click();
  await expect(page.locator('.difficulty-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await page.getByRole('group', { name: 'Answer options' }).getByRole('button').nth(0).click();
  const artifacts = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage).filter(([key]) =>
        /quiz|difficulty|completion|lesson:demo/.test(key),
      ),
    ),
  );
  await studio(page).click();
  await furigana(page).click();
  await expect(page.locator('.quiz-question ruby')).not.toHaveCount(0);
  await expect(page.locator('.quiz-question')).toHaveAccessibleName(
    questions.questions[0].question,
  );
  await expect(page.locator('.quiz-option ruby')).not.toHaveCount(0);
  await expect(page.locator('.quiz-feedback blockquote ruby')).not.toHaveCount(0);
  expect(await sourceText(page, '.quiz-question')).toBe(questions.questions[0].question);
  expect(await sourceText(page, '.quiz-feedback blockquote')).toBe(
    questions.questions[0].evidence.quote,
  );
  await expect(page.locator('.quiz-option.chosen')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      Object.fromEntries(
        Object.entries(localStorage).filter(([key]) =>
          /quiz|difficulty|completion|lesson:demo/.test(key),
        ),
      ),
    ),
  ).toEqual(artifacts);
  const studioLayout = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {
      media: rect('.media-frame'),
      current: rect('.current-card'),
      transcript: rect('.transcript-card'),
      quiz: rect('.quiz-card'),
      difficulty: rect('.difficulty-card'),
    };
  });
  expect(studioLayout.current.left).toBeGreaterThan(studioLayout.media.right - 2);
  expect(Math.abs(studioLayout.current.top - studioLayout.media.top)).toBeLessThan(3);
  expect(studioLayout.transcript.top).toBeGreaterThan(studioLayout.media.bottom);
  expect(studioLayout.transcript.height).toBeLessThanOrEqual(720);
  expect(studioLayout.quiz.top).toBeGreaterThan(studioLayout.media.bottom);
  expect(studioLayout.difficulty.top).toBeGreaterThan(studioLayout.media.bottom);
  const transcriptOverflow = await page.locator('.transcript-scroll').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(transcriptOverflow.overflowY).toBe('auto');
  expect(transcriptOverflow.scrollHeight).toBeGreaterThan(transcriptOverflow.clientHeight);
  for (const selector of ['.transcript-card', '.difficulty-card', '.quiz-card']) {
    await page.locator(selector).scrollIntoViewIfNeeded();
    await expect(page.locator(selector)).toBeVisible();
  }
  await page.getByRole('button', { name: 'Replay relevant section' }).click();
  await expect(page.locator('.media-frame')).toBeInViewport();
  await expect(page.locator('.evidence-banner')).toBeVisible();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(2);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 7.86;
  });
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await page
    .locator('.evidence-banner')
    .getByRole('button', { name: 'Return to question' })
    .click();
  await expect(page.locator('.quiz-option.chosen')).toHaveCount(1);
  await studio(page).click();
  await furigana(page).click();
  await expect(page.locator('.quiz-option.chosen')).toHaveCount(1);
  expect(calls).toBe(1);
});

test('layout toggles preserve in-progress recording and recorded A/B audio', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await open(page);
  await page.getByRole('button', { name: 'Record yourself', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('RECORDING');
  await studio(page).click();
  await furigana(page).click();
  await expect(page.getByTestId('playback-state')).toContainText('RECORDING');
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByLabel('Your recorded attempt')).toHaveAttribute('src', /^blob:/);
  const src = await page.getByLabel('Your recorded attempt').getAttribute('src');
  await studio(page).click();
  await furigana(page).click();
  await expect(page.getByLabel('Your recorded attempt')).toHaveAttribute('src', src!);
});

test('Studio desktop/mobile/tablet, long ruby text, translations and screenshots', async ({
  page,
}) => {
  await open(page);
  await page.screenshot({ path: 'artifacts/normal-desktop.png', fullPage: true });
  await studio(page).click();
  await page.screenshot({ path: 'artifacts/studio-desktop-plain.png', fullPage: true });
  const video = await page.locator('.media-frame').boundingBox(),
    main = await page.locator('.practice-main').boundingBox(),
    current = await page.locator('.current-card').boundingBox(),
    recording = await page.locator('.recording-panel').boundingBox();
  expect(video!.width / main!.width).toBeGreaterThan(0.68);
  expect(video!.width / video!.height).toBeGreaterThanOrEqual(16 / 9 - 0.02);
  expect(current!.x).toBeGreaterThan(video!.x + video!.width - 2);
  expect(Math.abs(current!.y - video!.y)).toBeLessThan(3);
  expect(Math.abs(recording!.x - current!.x)).toBeLessThan(3);
  expect(Math.abs(recording!.width - current!.width)).toBeLessThan(3);
  expect(recording!.y).toBeGreaterThanOrEqual(current!.y + current!.height - 2);
  await expect(page.getByTestId('current-japanese')).toBeVisible();
  await furigana(page).click();
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
  await page.setViewportSize({ width: 1366, height: 768 });
  expect((await page.locator('#current-japanese').boundingBox())!.y).toBeLessThan(768);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'artifacts/studio-desktop-ruby.png', fullPage: true });
  await page.screenshot({ path: 'artifacts/studio-desktop-viewport.png' });
  const currentBeforeTranslation = await page.locator('.current-card').boundingBox();
  await page.getByRole('button', { name: 'Reveal translation T' }).click();
  await expect(page.locator('#current-translation')).toBeVisible();
  const currentAfterTranslation = await page.locator('.current-card').boundingBox();
  expect(Math.abs(currentAfterTranslation!.height - currentBeforeTranslation!.height)).toBeLessThan(
    3,
  );
  expect((await page.locator('#current-translation').boundingBox())!.height).toBeLessThanOrEqual(
    180,
  );
  await page.screenshot({ path: 'artifacts/studio-desktop-ruby-translation.png', fullPage: true });
  await page.evaluate((lesson) => {
    lesson.id = 'long-display-test';
    lesson.segments[0].japanese =
      '日本語を勉強しています。今日は天気がいいですね。食べました。大丈夫です。'.repeat(8);
    localStorage.setItem('hibiki:v1:lesson:long-display-test', JSON.stringify(lesson));
  }, structuredClone(demo));
  await page.goto('/practice/long-display-test');
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
  for (const width of [1440, 820, 390, 320]) {
    await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const rects = await page.locator('#current-japanese').evaluate((element) => ({
      container: element.getBoundingClientRect().toJSON(),
      readings: [...element.querySelectorAll('rt')].map((rt) =>
        rt.getBoundingClientRect().toJSON(),
      ),
    }));
    expect(
      rects.readings.every(
        (rt) => rt.top >= rects.container.top - 8 && rt.bottom <= rects.container.bottom + 2,
      ),
    ).toBe(true);
    expect((await page.locator('#current-japanese').boundingBox())!.height).toBeGreaterThan(150);
    await page.getByRole('button', { name: 'Reveal translation T' }).click();
    await expect(page.locator('#current-translation')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: `artifacts/studio-long-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Hide translation T' }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/practice/demo');
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
  await page.screenshot({ path: 'artifacts/studio-mobile-ruby.png', fullPage: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'artifacts/studio-mobile-viewport.png' });
});

test('unavailable reading assets leave practice usable and can be retried', async ({ page }) => {
  await page.route('**/furigana/v1/worker.js', (route) => route.abort());
  await open(page);
  await furigana(page).click();
  await expect(page.locator('#current-japanese .japanese-text')).toHaveAttribute(
    'title',
    /unavailable/,
  );
  expect(await sourceText(page, '#current-japanese')).toBe(demo.segments[0].japanese);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.unroute('**/furigana/v1/worker.js');
  await furigana(page).click();
  await furigana(page).click();
  await expect(page.locator('#current-japanese ruby')).not.toHaveCount(0);
});
