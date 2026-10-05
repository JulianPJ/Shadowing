import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import path from 'node:path';

async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
}
test('listen → automatic pause → repeat → next; translation, speed, continuous and refresh', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openDemo(page);
  await expect(page.locator('#current-translation')).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal translation T' }).click();
  await expect(page.locator('#current-translation')).toContainText(demo.segments[0].translation);
  await page.getByRole('button', { name: 'Hide translation T' }).click();
  await expect(page.locator('#current-translation')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.25');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  const stopped = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => ({ paused: video.paused, time: video.currentTime }));
  expect(stopped.paused).toBe(true);
  expect(Math.abs(stopped.time - demo.segments[0].end)).toBeLessThan(0.15);
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeLessThan(2);
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[2].japanese);
  await page.getByRole('button', { name: 'Previous section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await page.getByRole('button', { name: 'Continuous', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[2].japanese);
  expect(await page.locator('video').evaluate((video: HTMLVideoElement) => video.paused)).toBe(
    false,
  );
  const before = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  await page.getByRole('button', { name: 'Shadowing', exact: true }).click();
  const after = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  expect(after).toBeGreaterThanOrEqual(before);
  expect(after - before).toBeLessThan(1);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.getByTestId('transcript-9').click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[9].japanese);
  await page.reload();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[9].japanese);
  await expect(page.getByRole('combobox', { name: 'Playback speed' })).toHaveValue('1.25');
  expect(errors).toEqual([]);
});
test('playback offset shifts authored pause and navigation timing', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'hibiki:v1:preferences',
      JSON.stringify({
        mode: 'shadowing',
        speed: 1,
        translation: false,
        studioMode: false,
        furigana: false,
        playbackOffsetMs: 400,
      }),
    );
  });
  await openDemo(page);
  await expect(page.getByRole('button', { name: 'Reset playback timing offset' })).toHaveText(
    '+400 ms',
  );
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');

  await page.locator('video').evaluate(
    (video: HTMLVideoElement, end: number) => {
      video.currentTime = end + 0.1;
    },
    demo.segments[0].end,
  );
  await page.waitForTimeout(120);
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');

  await page.locator('video').evaluate(
    (video: HTMLVideoElement, end: number) => {
      video.currentTime = end + 0.45;
    },
    demo.segments[0].end,
  );
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  const stoppedAt = await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.currentTime);
  expect(stoppedAt).toBeGreaterThan(demo.segments[0].end + 0.3);

  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect
    .poll(() => page.locator('video').evaluate((video: HTMLVideoElement) => video.currentTime))
    .toBeGreaterThan(demo.segments[1].start + 0.3);
});

test('real MediaRecorder captures and replays; native replay stops the recording playback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await openDemo(page);
  await page.getByRole('button', { name: 'Record yourself', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('RECORDING');
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Record again' })).toBeVisible();
  const audio = page.getByLabel('Your recorded attempt');
  await expect(audio).toHaveAttribute('src', /^blob:/);
  await audio.evaluate(async (element: HTMLAudioElement) => {
    await element.play();
  });
  await expect
    .poll(() => audio.evaluate((element: HTMLAudioElement) => element.currentTime))
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await expect.poll(() => audio.evaluate((element: HTMLAudioElement) => element.paused)).toBe(true);
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByLabel('Your recorded attempt')).toHaveCount(0);
});
test('denied microphone permission offers recovery without blocking playback', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Record yourself', exact: true }).click();
  await expect(page.locator('.recording-error')).toContainText('Microphone access was denied');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
});
test('imported local media and SRT play, pause, translate and recover on refresh', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media or subtitles' }).click();
  await page.getByRole('button', { name: 'Own media', exact: true }).click();
  await page.getByLabel('Audio or video file').setInputFiles(path.resolve('public/demo.mp4'));
  await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
  await page.getByLabel('Japanese subtitle file').setInputFiles(path.resolve('public/demo.vtt'));
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.reload();
  await expect(page.getByLabel('Reattach media')).toBeAttached();
  await page.getByLabel('Reattach media').setInputFiles(path.resolve('public/demo.mp4'));
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
});
test('invalid URL, shortcut typing guard, bookmarks, search, and mobile layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page
    .getByRole('textbox', { name: 'Paste a Japanese video link' })
    .fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Start shadowing' }).click();
  await expect(page.locator('.error-message')).toContainText('HTTP(S)');
  await page.screenshot({ path: 'artifacts/home-mobile.png', fullPage: true });
  await page.getByRole('link', { name: 'Try the demo', exact: true }).last().click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save this section for practice' }).click();
  await page.getByRole('button', { name: 'Show saved sections' }).click();
  await expect(page.locator('.transcript-row')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show all sections' }).click();
  await page.getByRole('textbox', { name: 'Search Japanese transcript' }).fill('公園');
  await expect(page.locator('.transcript-row')).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Search Japanese transcript' }).press('ArrowRight');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
  await page.getByRole('textbox', { name: 'Search Japanese transcript' }).fill('');
  await page.locator('body').click({ position: { x: 3, y: 3 } });
  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await page.keyboard.press('t');
  await expect(page.locator('#current-translation')).toContainText(demo.segments[1].translation);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/player-mobile.png', fullPage: true });
});

test('shadowing analysis is explicit, scores one recording, and shows aggregate at completion', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  let transcriptions = 0;
  let feedbackCalls = 0;
  let summaryCalls = 0;

  await page.route('**/api/shadowing/transcribe', async (route) => {
    transcriptions++;
    expect(route.request().headers()['content-type']).toContain('audio/');
    expect(Number(route.request().headers()['x-hibiki-recording-duration-ms'])).toBeGreaterThan(1900);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        recognizedText: demo.segments[0].japanese,
        speechStart: 0,
        speechEnd: demo.segments[0].end - demo.segments[0].start,
        provider: 'Cloudflare Whisper large-v3-turbo',
      }),
    });
  });
  await page.route('**/api/shadowing/feedback', async (route) => {
    feedbackCalls++;
    const input = route.request().postDataJSON();
    expect(input.score).toBe(100);
    expect(input.targetText).toBe(demo.segments[0].japanese);
    expect(input.recognizedText).toBe(demo.segments[0].japanese);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        suggestions: [
          'Your speech was recognised very close to the target wording.',
          'Your overall pacing was close to the reference timing.',
        ],
        provider: 'Qwen',
      }),
    });
  });
  await page.route('**/api/shadowing/summary', async (route) => {
    summaryCalls++;
    const input = route.request().postDataJSON();
    expect(input.score).toBe(100);
    expect(input.scoredSections).toBe(1);
    expect(input.totalSections).toBe(demo.segments.length);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        wentWell: 'Your speech was recognised accurately and your pacing matched the reference.',
        keepWorking: 'Keep applying the same clear rhythm across more sections.',
        provider: 'Qwen',
      }),
    });
  });

  await openDemo(page);
  await page.getByRole('button', { name: 'Record yourself', exact: true }).click();
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.getByRole('button', { name: 'Analyse attempt', exact: true })).toBeVisible();

  expect(transcriptions).toBe(0);
  expect(feedbackCalls).toBe(0);
  await expect(page.getByText('Analysing sends only this recording to Cloudflare AI')).toBeVisible();

  await page.getByRole('button', { name: 'Analyse attempt', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Shadowing Match' })).toBeVisible();
  await expect(page.locator('.shadowing-score')).toHaveText('100');
  await expect(
    page.locator('.shadowing-result').getByText(demo.segments[0].japanese, { exact: true }),
  ).toHaveCount(2);
  expect(transcriptions).toBe(1);
  expect(feedbackCalls).toBe(1);

  const stored = await page.evaluate(() =>
    JSON.parse(sessionStorage.getItem('hibiki:shadowing:v1:demo') || 'null'),
  );
  expect(stored.sections['segment-1'].score).toBe(100);
  expect(Object.keys(stored.sections)).toEqual(['segment-1']);

  await page.getByTestId('transcript-13').click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[13].japanese);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.getByRole('button', { name: 'Finish practice', exact: true }).click();

  await expect(page.getByRole('heading', { name: '100 / 100' })).toBeVisible();
  await expect(page.getByText(`Scored 1 of ${demo.segments.length} shadowing sections`)).toBeVisible();
  await expect(page.getByText('You made a little progress today.')).toBeVisible();
  await expect(page.getByText('Your speech was recognised accurately and your pacing matched the reference.')).toBeVisible();
  expect(summaryCalls).toBe(1);
});
