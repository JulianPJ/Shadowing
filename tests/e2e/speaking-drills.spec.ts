import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { mockProAccount } from '../helpers/pro-account';

async function openDemo(page: Page) {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
}
async function reachBoundary(page: Page, index = 0) {
  await page.locator('video').evaluate((video: HTMLVideoElement, end: number) => {
    video.currentTime = end - 0.03;
  }, demo.segments[index].end);
}

test('keyboard word lookup opens help without advancing or starting source playback', async ({
  page,
}) => {
  await openDemo(page);
  const firstWord = page.getByTestId('current-japanese').locator('[role="button"]').first();
  await firstWord.focus();
  await firstWord.press('Enter');
  await expect(
    page.getByRole('complementary', { name: 'Save vocabulary', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('current-japanese')).toHaveAttribute(
    'aria-label',
    demo.segments[0].japanese,
  );
  await expect(page.getByTestId('playback-state')).toContainText('READY WHEN YOU ARE');
  await page.getByRole('button', { name: 'Close vocabulary lookup' }).click();
  await firstWord.focus();
  await firstWord.press('Space');
  await expect(
    page.getByRole('complementary', { name: 'Save vocabulary', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('playback-state')).toContainText('READY WHEN YOU ARE');
});

test('Drill plays the selected section twice then pauses; Support reveals help only after a pause', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByLabel('Practice preset', { exact: true }).selectOption('drill');
  await expect(page.getByLabel('Source repeat count')).toHaveValue('2');
  await expect(page.getByLabel('Section pause behavior')).toHaveValue('manual');
  await expect(page.getByLabel('Translation reveal behavior')).toHaveValue('manual');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await reachBoundary(page);
  await expect
    .poll(() => page.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeLessThan(2);
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await reachBoundary(page);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
  await expect(page.locator('#current-translation')).toHaveCount(0);

  await page.getByLabel('Practice preset', { exact: true }).selectOption('support');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.locator('#current-translation')).toHaveCount(0);
  await reachBoundary(page);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await expect(page.locator('#current-translation')).toContainText(demo.segments[0].translation);
  await page.screenshot({ path: 'artifacts/phase-c-drill-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByLabel('Practice preset', { exact: true })).toHaveValue('support');
  await expect(page.locator('#current-translation')).toContainText(demo.segments[0].translation);
  await page.getByLabel('Practice preset', { exact: true }).selectOption('focus');
  await expect(page.locator('#current-translation')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: 'artifacts/phase-c-drill-mobile.png', fullPage: true });
});

test('timed speaking window advances once and stops cleanly on an explicit stop or navigation', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByLabel('Section pause behavior').selectOption('timed');
  await page.getByLabel('Speaking window seconds').fill('2');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await reachBoundary(page);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await page.getByRole('button', { name: 'Stop timed practice' }).click();
  await expect(page.getByLabel('Section pause behavior')).toHaveValue('manual');
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  await page.getByLabel('Section pause behavior').selectOption('timed');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await reachBoundary(page, 1);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.getByTestId('transcript-3').click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.waitForTimeout(2300);
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[3].japanese);
});

test('hands-free drill records for its visible window, advances, and interruption stops the microphone', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await openDemo(page);
  await page.getByLabel('Practice preset', { exact: true }).selectOption('drill');
  await page.getByLabel('Source repeat count').selectOption('1');
  await page.getByLabel('Speaking window seconds').fill('2');
  await page.getByRole('button', { name: 'Start hands-free drill' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await reachBoundary(page);
  await expect(page.getByTestId('playback-state')).toContainText('RECORDING');
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await expect(page.getByRole('button', { name: 'Stop hands-free drill' })).toBeVisible();
  await reachBoundary(page, 1);
  await expect(page.getByTestId('playback-state')).toContainText('RECORDING');
  await page.getByRole('button', { name: 'Stop hands-free drill' }).click();
  await expect(page.getByTestId('playback-state')).not.toContainText('RECORDING');
  await page.waitForTimeout(2300);
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await expect(page.getByRole('button', { name: 'Start hands-free drill' })).toBeVisible();
  expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test('recognition diagnostics show omissions and pacing evidence; section trend survives a new tab', async ({
  page,
  context,
}) => {
  await mockProAccount(page);
  await context.grantPermissions(['microphone']);
  let attempts = 0;
  await page.route('**/api/shadowing/transcribe', async (route) => {
    attempts++;
    // Account hydration refreshes unrelated learner data during a pending explicit analysis.
    await page.evaluate(() => window.dispatchEvent(new Event('hibiki:sync-hydrated')));
    return route.fulfill({
      json: {
        recognizedText:
          attempts === 1
            ? 'おはようございます。今日は、私の朝の過ごし方を紹介します。'
            : 'おはようございます。今日は、私の朝の過ごし方を紹介。',
        speechStart: 0,
        speechEnd: attempts === 1 ? demo.segments[0].end : demo.segments[0].end * 1.5,
        provider: 'Deterministic browser fixture',
      },
    });
  });
  await page.route('**/api/shadowing/feedback', (route) =>
    route.fulfill({ json: { suggestions: ['Listen again to the section ending.'] } }),
  );
  await openDemo(page);
  for (let attempt = 0; attempt < 2; attempt++) {
    await page
      .getByRole('button', { name: attempt ? 'Record again' : 'Record yourself', exact: true })
      .click();
    await page.waitForTimeout(2100);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await page.getByRole('button', { name: 'Analyse attempt', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Attempt analysed', exact: true }),
    ).toBeDisabled();
  }
  await expect(page.getByLabel('Recognized alignment chunks')).toContainText('Not heard');
  await expect(page.getByTestId('shadowing-pace')).toContainText('50% longer than source');
  await expect(page.getByLabel('Recent section trend')).toContainText('Down');
  await expect(page.getByLabel('Recent section trend')).toContainText('2 valid attempts');
  // Clearing sessionStorage simulates closing the tab; compact trend stays in localStorage.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByLabel('Recent section trend')).toContainText('2 valid attempts');
  await expect(page.getByRole('heading', { name: 'Shadowing Match', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByLabel('Recent section trend')).toHaveCount(0);
});

test('denied hands-free permission leaves manual practice usable; final boundary completes once', async ({
  page,
}) => {
  await openDemo(page);
  await page.getByLabel('Practice preset', { exact: true }).selectOption('drill');
  await page.getByRole('button', { name: 'Start hands-free drill' }).click();
  await expect(page.locator('.recording-error')).toContainText(
    'Microphone access was denied or unavailable',
  );
  await expect(page.getByRole('button', { name: 'Start hands-free drill' })).toBeVisible();
  await page.getByLabel('Practice preset', { exact: true }).selectOption('focus');
  await page.getByLabel('Section pause behavior').selectOption('timed');
  await page.getByLabel('Speaking window seconds').fill('2');
  await page.getByTestId(`transcript-${demo.segments.length - 1}`).click();
  await reachBoundary(page, demo.segments.length - 1);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page
    .locator('video')
    .evaluate((video: HTMLVideoElement) => video.dispatchEvent(new Event('ended')));
  await expect(page.getByRole('heading', { name: 'Lesson complete', exact: true })).toBeVisible();
  await expect(page.getByTestId('playback-state')).toContainText('WELL PRACTICED');
});
