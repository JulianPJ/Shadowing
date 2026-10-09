import { test, expect } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { applyLocalReview } from '../../src/lib/review/local';
import { connect, seed } from '../helpers/retention-account';
for (const plan of ['free', 'pro'] as const)
  test(`${plan}: save and study during practice, reveal, context replay and grade`, async ({
    page,
    context,
  }) => {
    const remote = await connect(context, plan);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (plan === 'free') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/practice/demo');
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
    await page.locator('#current-japanese .lookup-token').first().click();
    const meaning = 'good morning';
    await page.getByText('Edit before saving', { exact: true }).click();
    await expect(page.getByLabel('Vocabulary meaning')).not.toHaveValue('');
    await page.getByLabel('Vocabulary meaning').fill(meaning);
    await page.getByRole('button', { name: 'Add to review', exact: true }).click();
    await expect(page.getByText('In review', { exact: true })).toBeVisible();
    await expect.poll(() => remote.entries[0]?.translation).toBe(meaning);
    await expect.poll(() => remote.review.cards.length).toBe(1);
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: '1 due now' })).toBeVisible();
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByText(meaning, { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: /Show answer/ }).click();
    await expect(page.getByText(meaning, { exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/review-${plan}.png`, fullPage: true });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Open full lesson ↗', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
    await popup.close();
    await page.getByRole('button', { name: /^Good/ }).click();
    await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
    await expect.poll(() => remote.review.cards[0].repetitions).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
test('all four grades advance the session and persist deterministic state across devices', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    remote = await connect(context);
  await seed(remote, 4);
  const page = await context.newPage();
  try {
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: '4 due now' })).toBeVisible();
    await page.getByRole('button', { name: 'Start review' }).click();
    for (const grade of ['Again', 'Hard', 'Good', 'Easy']) {
      await page.getByRole('button', { name: /Show answer/ }).click();
      await page.getByRole('button', { name: new RegExp(`^${grade}`) }).click();
    }
    await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
    await expect.poll(() => remote.review.cards.map((c) => c.revision)).toEqual([1, 1, 1, 1]);
    expect(remote.review.cards.map((c) => c.intervalDays)).toEqual([0, 0, 0, 4]);
    const second = await browser.newContext();
    await connect(second); // Replace mock routes with the first device's authoritative state.
    await second.route('**/api/review', (route) => route.fulfill({ json: remote.review }));
    await second.route('**/api/dictionary*', (route) =>
      route.fulfill({ json: { entries: remote.entries } }),
    );
    const other = await second.newPage();
    await other.goto('/review');
    await expect(other.getByRole('heading', { name: '0 due now' })).toBeVisible();
    await second.close();
  } finally {
    await context.close();
  }
});

test('offline grading survives reload and retries without duplicating reviews', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '1 due now' })).toBeVisible();
  await page.getByRole('button', { name: 'Start review' }).click();
  remote.offline = true;
  await page.getByRole('button', { name: /Show answer/ }).click();
  await page.getByRole('button', { name: /^Easy/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:review:pending') || '[]',
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  expect(remote.review.cards[0].revision).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today’s review is complete' })).toBeVisible();
  remote.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => remote.review.cards[0].revision).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Today’s review is complete' })).toBeVisible();
  expect(remote.writes.filter((w) => w.action === 'grade')).toHaveLength(1);
});
test('completion recap links saved lesson words already enrolled in review to the daily queue', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByTestId('transcript-13').click();
  await page.getByRole('button', { name: /Finish practice/ }).click();
  const recap = page.getByRole('region', { name: 'Lesson recap' });
  await expect(page.getByRole('region', { name: 'Lesson completion summary' })).toContainText(
    'You reached the end of this lesson.',
  );
  await page.getByText('Saved words and practice details', { exact: true }).click();
  await expect(recap).toContainText('1 saved word · 1 in review');
  expect(remote.review.cards).toHaveLength(1);
  await recap.getByRole('link', { name: 'Review your words' }).click();
  await expect(page.getByRole('heading', { name: '1 due now' })).toBeVisible();
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.locator('.review-card h2')).toHaveText(remote.entries[0].term);
});

test('review source links refuse a changed transcript revision', async ({ page, context }) => {
  const remote = await connect(context);
  await seed(remote, 1);
  remote.entries[0].source.transcriptKey = 'a'.repeat(64);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review' }).click();
  await page.getByRole('button', { name: /Show answer/ }).click();
  const promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Open full lesson ↗', exact: true }).click();
  const popup = await promise;
  await expect(
    popup.getByRole('heading', { name: 'This saved context has changed.' }),
  ).toBeVisible();
  await expect(popup.locator('video')).toHaveCount(0);
  await popup.close();
  await expect(page.getByRole('button', { name: /^Good/ })).toBeVisible();
});

test('an account-cookie mismatch preserves the old account review outbox', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review' }).click();
  await context.route('**/api/review', (route) =>
    route.fulfill({ status: 409, json: { error: 'Account changed. Refresh your session.' } }),
  );
  await page.getByRole('button', { name: /Show answer/ }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:review:pending') || '[]',
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:review:pending') || '[]',
          ).length,
      ),
    )
    .toBe(1);
  expect(remote.review.cards[0].revision).toBe(0);
});

test('a competing device grade restores its schedule and reports a review conflict', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review' }).click();
  remote.review = applyLocalReview(remote.review, {
    action: 'grade',
    entryId: 'word-0',
    revision: 0,
    grade: 'easy',
    reviewedAt: new Date().toISOString(),
    operationId: 'other-device',
  });
  await context.route('**/api/review', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          json: { code: 'review-conflict', error: 'This word changed on another device.' },
        })
      : route.fulfill({ json: remote.review }),
  );
  await page.getByRole('button', { name: /Show answer/ }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  await expect(
    page.getByText('A review changed on another device. Its latest schedule was restored.'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:review:pending') || '[]',
          ).length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('hibiki:v1:account:retention-free:review:data')!).cards[0]
          .intervalDays,
    ),
  ).toBe(4);
});
