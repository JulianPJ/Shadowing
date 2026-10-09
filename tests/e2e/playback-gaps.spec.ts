import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };

const lesson = {
  ...demo,
  id: 'playback-gaps',
  mediaSource: { schemaVersion: 1, type: 'demo' },
  transcriptSource: 'Generated subtitles',
  segments: [
    { ...demo.segments[0], start: 5, end: 7 },
    { ...demo.segments[1], start: 20, end: 25 },
    { ...demo.segments[2], start: 50, end: 55 },
  ],
};

async function openLesson(page: Page, mode = 'shadowing', offset = 0) {
  await page.addInitScript(
    ({ lesson, mode, offset }) => {
      localStorage.setItem(`hibiki:v1:lesson:${lesson.id}`, JSON.stringify(lesson));
      localStorage.setItem(
        'hibiki:v1:preferences',
        JSON.stringify({ mode, speed: 1, playbackOffsetMs: offset }),
      );
    },
    { lesson, mode, offset },
  );
  await page.goto(`/practice/${lesson.id}`);
  await expect(
    page.getByRole('button', { name: mode === 'shadowing' ? 'Listen' : 'Play', exact: true }),
  ).toBeEnabled();
}

async function time(page: Page) {
  return page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime);
}

async function firstBoundary(page: Page, offset = 0) {
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => time(page)).toBeGreaterThan(5 + offset + 0.1);
  await page.locator('video').evaluate((v: HTMLVideoElement, end) => {
    v.currentTime = end;
  }, 7 + offset);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
}

for (const offset of [0, 0.4]) {
  test(`Continue preserves gaps, pause/resume, speech replay and navigation (offset ${offset}s)`, async ({
    page,
  }) => {
    await openLesson(page, 'shadowing', offset * 1000);
    await firstBoundary(page, offset);
    const stopped = await time(page);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(page.getByTestId('current-japanese')).toHaveText(lesson.segments[1].japanese);
    await expect.poll(() => time(page)).toBeGreaterThan(stopped + 0.2);
    expect(await time(page)).toBeLessThan(10 + offset);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const paused = await time(page);
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await expect.poll(() => time(page)).toBeGreaterThan(paused + 0.2);
    expect(await time(page)).toBeLessThan(12 + offset);
    await page.locator('video').evaluate((v: HTMLVideoElement, end) => {
      v.currentTime = end;
    }, 25 + offset);
    await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect.poll(() => time(page)).toBeGreaterThan(25 + offset + 0.2);
    expect(await time(page)).toBeLessThan(30 + offset);
    await page.getByTestId('transcript-1').click();
    await expect.poll(() => time(page)).toBeGreaterThanOrEqual(20 + offset);
    expect(await time(page)).toBeLessThan(22 + offset);
    await page.getByRole('button', { name: 'Replay R' }).click();
    await expect.poll(() => time(page)).toBeGreaterThanOrEqual(20 + offset);
    expect(await time(page)).toBeLessThan(22 + offset);
    await expect.poll(() => time(page)).toBeGreaterThan(20 + offset + 0.2);
    await page.locator('video').evaluate((v: HTMLVideoElement, end) => {
      v.currentTime = end;
    }, 25 + offset);
    await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
    const saved = await page.evaluate(
      () => JSON.parse(localStorage.getItem('hibiki:v1:lesson:playback-gaps')!).segments,
    );
    expect(saved).toEqual(lesson.segments);
  });
}

test('timed continuation plays the gap instead of seeking to the next subtitle', async ({
  page,
}) => {
  await openLesson(page);
  await page.getByText('Advanced settings', { exact: true }).click();
  await page.getByLabel('Section pause behavior').selectOption('timed');
  await page.getByLabel('Speaking window seconds').fill('2');
  await firstBoundary(page);
  await expect(page.getByTestId('current-japanese')).toHaveText(lesson.segments[1].japanese);
  await expect.poll(() => time(page)).toBeGreaterThan(7.2);
  expect(await time(page)).toBeLessThan(10);
  await page.getByRole('button', { name: 'Stop timed practice' }).click();
});

test('Continuous plays through gaps and footage after the last subtitle', async ({ page }) => {
  await openLesson(page, 'continuous');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect.poll(() => time(page)).toBeGreaterThan(5.2);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 8;
  });
  await expect.poll(() => time(page)).toBeGreaterThan(8.3);
  expect(await time(page)).toBeLessThan(12);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 56;
  });
  await expect.poll(() => time(page)).toBeGreaterThan(56.3);
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('native seeking before the first subtitle and back into speech still follows the transcript', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openLesson(page);
  await firstBoundary(page);
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => time(page)).toBeGreaterThan(7.2);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 5.5;
  });
  await expect(page.getByTestId('current-japanese')).toHaveText(lesson.segments[0].japanese);
  await page.locator('video').evaluate((v: HTMLVideoElement) => {
    v.currentTime = 0;
  });
  await expect.poll(() => time(page)).toBeGreaterThan(0.3);
  expect(errors).toEqual([]);
});
