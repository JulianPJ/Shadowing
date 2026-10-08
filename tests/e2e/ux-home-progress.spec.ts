import { test, expect } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };

test('preparation failure preserves the link and offers direct retry into a working lesson', async ({
  page,
}) => {
  let attempts = 0;
  await page.route('**/api/prepare', (route) => {
    attempts++;
    return attempts === 1
      ? route.fulfill({
          status: 503,
          json: { error: 'Captions could not be fetched. Please retry.' },
        })
      : route.fulfill({
          contentType: 'application/x-ndjson',
          body: JSON.stringify({ lesson: demo }) + '\n',
        });
  });
  await page.goto('/');
  await page
    .getByLabel('Paste a Japanese video link')
    .fill('https://www.youtube.com/watch?v=abcdefghijk');
  await page.getByRole('button', { name: 'Start shadowing' }).click();
  await expect(page.locator('.error-message[role="alert"]')).toContainText(
    'Captions could not be fetched',
  );
  await expect(page.getByLabel('Paste a Japanese video link')).toHaveValue(
    'https://www.youtube.com/watch?v=abcdefghijk',
  );
  await page.getByRole('button', { name: 'Retry preparation' }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  expect(attempts).toBe(2);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Make a little room for Japanese.' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /A quiet morning/ })).toBeVisible();
});

test('progress attention opens the exact section and daily goal can be edited', async ({
  page,
}) => {
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByTestId('transcript-1').click();
  await page.getByRole('button', { name: 'Replay R' }).click();
  await page.goto('/progress');
  await page.getByRole('link', { name: 'Replay section' }).first().click();
  await expect(page).toHaveURL(/section=.*transcript=/);
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  await page.goto('/progress');
  await page.getByRole('button', { name: 'Set a daily goal' }).click();
  await page.getByRole('button', { name: 'Edit daily goal' }).click();
  await page.getByLabel('Minutes per day').selectOption('10');
  await page.getByRole('button', { name: 'Save daily goal' }).click();
  await expect(page.locator('.daily-goal')).toContainText('/ 10 minutes today');
  await page.reload();
  await expect(page.locator('.daily-goal')).toContainText('/ 10 minutes today');
});
