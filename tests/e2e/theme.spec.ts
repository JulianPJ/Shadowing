import { expect, test } from '@playwright/test';

test('light and dark theme persist in a cookie without localStorage', async ({ page, context }) => {
  await context.clearCookies();
  await page.goto('/');

  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const darkToggle = page.getByRole('button', { name: 'Switch to dark mode' });
  await expect(darkToggle).toBeVisible();

  await darkToggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.getByRole('button', { name: 'Switch to light mode' })).toBeVisible();

  const darkCookie = (await context.cookies()).find((cookie) => cookie.name === 'hibiki-theme');
  expect(darkCookie?.value).toBe('dark');
  expect(await page.evaluate(() => localStorage.getItem('hibiki-theme'))).toBeNull();

  await page.goto('/progress');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await page.getByRole('button', { name: 'Switch to light mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const lightCookie = (await context.cookies()).find((cookie) => cookie.name === 'hibiki-theme');
  expect(lightCookie?.value).toBe('light');
  expect(await page.evaluate(() => localStorage.getItem('hibiki-theme'))).toBeNull();
});
