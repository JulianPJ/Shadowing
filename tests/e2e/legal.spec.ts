import { expect, test } from '@playwright/test';

const policies = [
  ['/terms', 'Terms of Service'],
  ['/privacy', 'Privacy Policy'],
  ['/refunds', 'Subscriptions, cancellations and refunds'],
  ['/cookies', 'Cookie & Local Storage Policy'],
  ['/contact', 'Contact & business details'],
] as const;

test('public legal pages render and footer links are available without signing in', async ({
  page,
}) => {
  for (const [route, heading] of policies) {
    await page.goto(route);
    await expect(page.getByRole('main').getByRole('heading', { name: heading })).toBeVisible();
    const footer = page.locator('footer.site-footer');
    for (const path of ['/terms', '/privacy', '/refunds', '/cookies', '/contact', '/notices'])
      await expect(footer.locator('a[href="' + path + '"]')).toHaveCount(1);
  }
});

test('registration links to the public legal policies', async ({ page }) => {
  await page.goto('/register');
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Terms of Service' }),
  ).toHaveAttribute('href', '/terms');
  await expect(
    page.getByRole('main').getByRole('link', { name: 'Privacy Policy' }),
  ).toHaveAttribute('href', '/privacy');
});

test('public pages do not initialize advertising, analytics or payment scripts', async ({ page }) => {
  const unexpected: string[] = [];
  page.on('request', (request) => {
    const hostname = new URL(request.url()).hostname;
    if (
      /(?:^|\\.)(?:google-analytics\\.com|googletagmanager\\.com|doubleclick\\.net|facebook\\.net|paddle\\.com)$/.test(
        hostname,
      )
    )
      unexpected.push(hostname);
  });
  for (const route of ['/', '/cookies', '/privacy', '/terms']) {
    await page.goto(route);
    await expect(page.locator('main')).toBeVisible();
  }
  expect(unexpected).toEqual([]);
});
