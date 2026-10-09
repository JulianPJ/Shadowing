import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import authoredDifficulty from '../../src/data/demo-difficulty.json' with { type: 'json' };
import { createDifficultyAnalysis } from '../../src/lib/difficulty';
import { createQuiz } from '../../src/lib/quiz/document';
import { transcriptRevision } from '../../src/lib/transcript';
import type { Lesson } from '../../src/lib/types';
import { mockProAccount, proStorageKey } from '../helpers/pro-account';

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
  await page.getByText('Advanced settings', { exact: true }).click();
  const offset = page.getByRole('button', { name: 'Reset playback timing offset' });
  await expect(offset).toHaveText('0 ms');
  for (let i = 0; i < 7; i++)
    await page.getByRole('button', { name: 'Shift playback timing 50 milliseconds later' }).click();
  await expect(offset).toHaveText('+350 ms');
  await expect(page.getByLabel('Practice preset', { exact: true })).toHaveValue('continuous');
  expect(assets).toEqual([]);
  await page.getByRole('button', { name: 'Save this section for practice' }).click();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeGreaterThan(0.3);
  const before = await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.dataset.mounted = 'same-player';
    return { time: v.currentTime, wall: performance.now() };
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
    wall: performance.now(),
  }));
  expect(after.time).toBeGreaterThanOrEqual(before.time);
  expect(
    Math.abs(after.time - before.time - ((after.wall - before.wall) / 1000) * 0.75),
  ).toBeLessThan(0.5);
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
  await page.getByRole('link', { name: 'Your practice', exact: true }).click();
  await page.goto('/practice/demo');
  await expect(studio(page)).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(studio(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('0.75');
  await page.getByText('Advanced settings', { exact: true }).click();
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
  await expect(page.getByTestId('transcript-0').locator('..').locator('ruby')).not.toHaveCount(0);
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
  await mockProAccount(page);
  const quiz = await createQuiz(questions, demo as Lesson);
  const analysis = await createDifficultyAnalysis(authoredDifficulty, demo as Lesson);
  await page.route('**/api/difficulty', (route) => route.fulfill({ json: { analysis } }));
  let calls = 0;
  await page.route('**/api/quiz', (route) => {
    calls++;
    return route.fulfill({ json: { quiz } });
  });
  await page.addInitScript(
    ({ key, revision }) => localStorage.setItem(key, JSON.stringify({ transcript: revision })),
    { key: proStorageKey('completion:demo'), revision: transcriptRevision(demo as Lesson) },
  );
  await open(page);
  await page.getByText('About this lesson’s difficulty', { exact: true }).click();
  await expect(page.locator('.difficulty-summary')).toBeVisible();
  await page.getByRole('button', { name: 'Take comprehension check' }).click();
  await page.getByRole('group', { name: 'Answer options' }).getByRole('button').nth(0).click();
  const artifacts = await page.evaluate(() =>
    Object.fromEntries(
      Object.entries(localStorage)
        .filter(([key]) => /quiz|difficulty|completion|lesson:demo/.test(key))
        // Account hydration validates/reserializes records; key order is not data.
        .map(([key, value]) => [key, JSON.parse(value)]),
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
        Object.entries(localStorage)
          .filter(([key]) => /quiz|difficulty|completion|lesson:demo/.test(key))
          .map(([key, value]) => [key, JSON.parse(value)]),
      ),
    ),
  ).toEqual(artifacts);
  const studioLayout = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect().toJSON();
    return {
      media: rect('.media-frame'),
      current: rect('.current-card'),
      quiz: rect('.quiz-card'),
      difficulty: rect('.difficulty-card'),
    };
  });
  expect(studioLayout.current.left).toBeGreaterThan(studioLayout.media.right - 2);
  expect(Math.abs(studioLayout.current.top - studioLayout.media.top)).toBeLessThan(3);
  expect(studioLayout.quiz.top).toBeGreaterThan(studioLayout.media.bottom);
  expect(studioLayout.difficulty.top).toBeGreaterThan(studioLayout.media.bottom);
  await page
    .getByRole('navigation', { name: 'Lesson tools' })
    .getByRole('button', { name: 'Transcript', exact: true })
    .click();
  await expect(page.locator('.quiz-card')).toBeHidden();
  const transcriptBox = await page.locator('.transcript-card').boundingBox();
  expect(transcriptBox!.y).toBeGreaterThan(studioLayout.media.bottom);
  expect(transcriptBox!.height).toBeLessThanOrEqual(720);
  const transcriptOverflow = await page.locator('.transcript-scroll').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(transcriptOverflow.overflowY).toBe('auto');
  expect(transcriptOverflow.scrollHeight).toBeGreaterThan(transcriptOverflow.clientHeight);
  await expect(page.locator('.transcript-card')).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Lesson tools' })
    .getByRole('button', { name: 'Lesson review', exact: true })
    .click();
  for (const selector of ['.difficulty-card', '.quiz-card']) {
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
  expect(video!.width / main!.width).toBeGreaterThan(0.58);
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
  expect(currentAfterTranslation!.height).toBeGreaterThanOrEqual(currentBeforeTranslation!.height);
  await expect(page.getByRole('button', { name: 'Replay R' })).toBeVisible();
  expect((await page.locator('.media-frame').boundingBox())!.x).toBe(video!.x);
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
    const dimensions = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      viewport: innerWidth,
    }));
    expect(dimensions.page, `Long furigana text at ${width}px`).toBeLessThanOrEqual(
      dimensions.viewport,
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

test('Studio tool panes keep the player mounted and transcript lookup never seeks in either site theme', async ({
  page,
}) => {
  await open(page);
  await page.locator('video').evaluate((video: HTMLVideoElement) => {
    video.dataset.uxPlayer = 'same-player';
  });
  await studio(page).click();
  const tools = page.getByRole('navigation', { name: 'Lesson tools' });
  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    await tools.getByRole('button', { name: 'Transcript', exact: true }).click();
    const row = page.locator('.transcript-row').nth(4);
    await row.locator('[data-lookup]').first().click();
    const lookup = row.getByRole('complementary', { name: 'Save vocabulary' });
    await expect(lookup).toBeVisible();
    await expect(lookup.locator('.dictionary-context [lang="ja"]')).toHaveText(
      demo.segments[4].japanese,
    );
    await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
    expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(
      true,
    );
    expect(
      await lookup.evaluate((element) => ({
        foreground: getComputedStyle(element).color,
        background: getComputedStyle(element).backgroundColor,
      })),
    ).toEqual({ foreground: 'rgb(241, 240, 233)', background: 'rgb(25, 30, 26)' });
    await lookup.getByRole('button', { name: 'Close vocabulary lookup' }).click();
    for (const name of ['Vocabulary', 'Lesson review', 'Transcript']) {
      await tools.getByRole('button', { name, exact: true }).click();
      expect(
        await page.locator('video').evaluate((video: HTMLVideoElement) => video.dataset.uxPlayer),
      ).toBe('same-player');
      await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
    }
  }
  await page.getByTestId('transcript-9').click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[9].japanese);
  await expect(page.locator('.transcript-row.past')).toHaveCount(0);
  await page.getByRole('button', { name: 'Exit Studio', exact: true }).click();
  await expect(page.locator('.practice-main')).not.toHaveClass(/studio-mode/);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Previous section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[8].japanese);
  await expect(page.getByText('Section position', { exact: true })).toBeVisible();
  expect(
    await page.locator('video').evaluate((video: HTMLVideoElement) => video.dataset.uxPlayer),
  ).toBe('same-player');
});

test('Vocabulary return restores the exact paused position and ignores a changed transcript', async ({
  page,
}) => {
  await open(page);
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(1);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const position = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.goto('/review');
  await page.getByRole('link', { name: 'Back to practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  const returned = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => ({ time: video.currentTime, paused: video.paused }));
  expect(returned.paused).toBe(true);
  expect(Math.abs(returned.time - position)).toBeLessThan(0.1);
  await expect(page.getByTestId('playback-state')).toContainText('TAKE A BREATH');
  await page.goto('/review');
  await page.evaluate(() => {
    const saved = JSON.parse(sessionStorage.getItem('hibiki:practice-return')!);
    saved.transcript = 'a replaced transcript';
    sessionStorage.setItem('hibiki:practice-return', JSON.stringify(saved));
  });
  await page.getByRole('link', { name: 'Back to practice', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  expect(
    await page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime),
  ).toBeLessThan(0.1);
  expect(await page.evaluate(() => sessionStorage.getItem('hibiki:practice-return'))).toBeNull();
});

test('Studio draws the current line over the video only when asked and remembers the choice', async ({
  page,
}) => {
  await open(page);
  const toggle = page.getByRole('button', { name: 'Subtitles on video', exact: true });
  await expect(toggle).toHaveCount(0);
  await studio(page).click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.subtitle-overlay')).toHaveCount(0);
  await toggle.click();
  const overlay = page.locator('.media-frame .subtitle-overlay');
  await expect(overlay).toHaveText(demo.segments[0].japanese);
  // The current-section card already exposes this text to assistive technology.
  await expect(overlay).toHaveAttribute('aria-hidden', 'true');
  await page.locator('body').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('ArrowRight');
  await expect(overlay).toHaveText(demo.segments[1].japanese);
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay).toBeVisible();
  await studio(page).click();
  await expect(page.locator('.subtitle-overlay')).toHaveCount(0);
});
