import type { Page } from '@playwright/test';
import { emptySync, type AccountUser } from '../../src/lib/sync/types';

export const proTestUser: AccountUser = {
  id: 'e2e-pro-account',
  email: 'pro@example.com',
  name: 'Pro learner',
  emailVerified: true,
  plan: 'pro',
};

export async function mockProAccount(page: Page) {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({
      json: {
        user: proTestUser,
        googleEnabled: false,
        emailEnabled: false,
      },
    }),
  );
  await page.route('**/api/sync/bootstrap*', (route) =>
    route.fulfill({ json: { data: emptySync(), nextCursor: null } }),
  );
  await page.route('**/api/sync/push', (route) => route.fulfill({ json: { ok: true } }));
}
