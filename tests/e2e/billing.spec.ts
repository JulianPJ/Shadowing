import { expect, test, type Page } from '@playwright/test';
import { mockProAccount, proTestUser } from '../helpers/pro-account';

async function billingPage(
  page: Page,
  options: {
    verified?: boolean;
    enabled?: boolean;
    managed?: boolean;
    paymentSuccess?: boolean;
  } = {},
) {
  await mockProAccount(page);
  let plan = 'free';
  await page.route('**/api/account/me', (route) =>
    route.fulfill({
      json: {
        user: { ...proTestUser, plan, emailVerified: options.verified ?? true },
        googleEnabled: false,
        emailEnabled: false,
      },
    }),
  );
  await page.route('**/api/auth/list-accounts', (route) =>
    route.fulfill({ json: [{ providerId: 'credential' }] }),
  );
  await page.route('**/api/billing', (route) => {
    expect(route.request().headers()['x-hibiki-account']).toBe(proTestUser.id);
    return route.fulfill({
      json: {
        enabled: options.enabled ?? true,
        environment: 'sandbox',
        canManage: options.managed ?? false,
        subscriptions: options.managed
          ? [
              {
                id: 'sub_test',
                status: 'past_due',
                interval: 'monthly',
                periodEnd: null,
                cancelAt: null,
                refunded: false,
              },
            ]
          : [],
      },
    });
  });
  await page.route('**/api/billing/checkout', (route) =>
    route.fulfill({
      json: {
        transactionId: 'txn_test',
        clientToken: 'test_browser_token',
        environment: 'sandbox',
      },
    }),
  );
  await page.route('https://cdn.paddle.com/paddle/v2/paddle.js', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `
    window.PaddleBillingV1 = {
      Initialized: false,
      Environment: { set(value) { window.testBillingEnvironment = value; } },
      Initialize(options) { this.Initialized = true; this.options = options; },
      Update(options) { this.options = options; },
      Checkout: { open(options) {
        window.testBillingCheckout = options;
        ${options.paymentSuccess ? 'window.PaddleBillingV1.options.eventCallback({name: "checkout.completed"});' : ''}
      } }
    };
  `,
    }),
  );
  return {
    paid() {
      plan = 'pro';
    },
  };
}

test('monthly/annual upgrade opens sandbox Paddle overlay with an authenticated server transaction', async ({
  page,
}) => {
  await billingPage(page);
  let interval = '';
  await page.route('**/api/billing/checkout', (route) => {
    const request = route.request();
    expect(request.headers()['x-hibiki-account']).toBe(proTestUser.id);
    interval = request.postDataJSON().interval;
    expect(Object.keys(request.postDataJSON())).toEqual(['interval']);
    return route.fulfill({
      json: {
        transactionId: 'txn_test',
        clientToken: 'test_browser_token',
        environment: 'sandbox',
      },
    });
  });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Upgrade · Annual' }).click();
  expect(interval).toBe('annual');
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { testBillingEnvironment?: string }).testBillingEnvironment,
      ),
    )
    .toBe('sandbox');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { testBillingCheckout?: { transactionId: string } })
            .testBillingCheckout?.transactionId,
      ),
    )
    .toBe('txn_test');
  await expect(page.getByText('Hibiki Free', { exact: true }).first()).toBeVisible();
});

test('checkout completion keeps Free until the server confirms Pro, then refresh updates the profile', async ({
  page,
}) => {
  const server = await billingPage(page, { paymentSuccess: true });
  await page.goto('/profile');
  await page.getByRole('button', { name: 'Upgrade · Monthly' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Payment received' })).toBeVisible();
  await expect(page.locator('.account-plan')).toHaveText('Hibiki Free');
  server.paid();
  await page.getByRole('button', { name: 'Refresh plan' }).click();
  await expect(page.locator('.account-plan')).toHaveText('Hibiki Pro');
  await expect(page.getByRole('button', { name: 'Upgrade · Monthly' })).toHaveCount(0);
});

test('disabled configuration and unverified accounts cannot open checkout', async ({ page }) => {
  await billingPage(page, { enabled: false });
  await page.goto('/profile');
  await expect(page.getByText('Subscriptions are awaiting setup.')).toBeVisible();
  await expect(page.getByRole('button', { name: /Upgrade ·/ })).toHaveCount(0);
  await billingPage(page, { verified: false });
  await page.reload();
  await expect(page.getByRole('button', { name: 'Upgrade · Monthly' })).toBeDisabled();
  await expect(page.getByText('Verify your email before subscribing.')).toBeVisible();
});

test('past-due subscription leads to a server-created Paddle customer portal session', async ({
  page,
}) => {
  await billingPage(page, { managed: true });
  await page.route('**/api/billing/portal', (route) => {
    expect(route.request().postDataJSON()).toEqual({});
    expect(route.request().headers()['x-hibiki-account']).toBe(proTestUser.id);
    return route.fulfill({
      json: { url: 'https://sandbox-customer-portal.paddle.com/session?token=test' },
    });
  });
  await page.route('https://sandbox-customer-portal.paddle.com/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Paddle sandbox portal</h1>' }),
  );
  await page.goto('/profile');
  await expect(page.getByText(/Your payment needs attention/)).toBeVisible();
  await page.getByRole('button', { name: 'Manage billing' }).click();
  await expect(page).toHaveURL('https://sandbox-customer-portal.paddle.com/session?token=test');
});

test('an owned hosted payment link opens only its authorized transaction and never upgrades from the URL', async ({
  page,
}) => {
  await billingPage(page);
  await page.route('**/api/billing?transactionId=*', (route) =>
    route.fulfill({
      json: {
        enabled: true,
        environment: 'sandbox',
        canManage: false,
        subscriptions: [],
        checkout: {
          transactionId: 'txn_owned',
          clientToken: 'test_browser_token',
          environment: 'sandbox',
        },
      },
    }),
  );
  await page.goto('/profile?_ptxn=txn_owned');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { testBillingCheckout?: { transactionId: string } })
            .testBillingCheckout?.transactionId,
      ),
    )
    .toBe('txn_owned');
  await expect(page).toHaveURL(/\/profile$/);
  await expect(page.locator('.account-plan')).toHaveText('Hibiki Free');
});

test('an unowned payment link cannot load Paddle or open checkout', async ({ page }) => {
  await billingPage(page);
  let paddleLoaded = false;
  await page.route('https://cdn.paddle.com/**', (route) => {
    paddleLoaded = true;
    return route.abort();
  });
  await page.route('**/api/billing?transactionId=*', (route) =>
    route.fulfill({ status: 403, json: { error: 'Checkout does not belong to this account.' } }),
  );
  await page.goto('/profile?_ptxn=txn_foreign');
  await expect(page.getByText('Could not load billing. Try refreshing your plan.')).toBeVisible();
  expect(paddleLoaded).toBe(false);
  await expect(page.locator('.account-plan')).toHaveText('Hibiki Free');
});
