import { expect, test, type Page } from '@playwright/test';
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import { mockDiscoverSync } from '../helpers/discover-account';

async function signedOut(page: Page) {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: true, emailEnabled: true } }),
  );
}

test('registration requires the 18+ confirmation for email and Google sign-up', async ({
  page,
}) => {
  await signedOut(page);
  const signUps: Record<string, unknown>[] = [];
  const social: Record<string, unknown>[] = [];
  await page.route('**/api/auth/sign-up/email', (route) => {
    signUps.push(route.request().postDataJSON());
    return route.fulfill({ json: { token: null, user: { id: 'new-learner' } } });
  });
  await page.route('**/api/auth/sign-in/social', (route) => {
    social.push(route.request().postDataJSON());
    // Stop before the Google redirect; the server contract is covered by unit tests.
    return route.fulfill({ status: 400, json: { message: 'Google is unavailable in tests.' } });
  });
  await page.goto('/register');
  const main = page.getByRole('main');
  const confirmation = main.getByRole('checkbox', { name: /I confirm that I am 18 or older/ });
  const google = main.getByRole('button', { name: 'Continue with Google' });
  await expect(confirmation).not.toBeChecked();
  await expect(google).toBeDisabled();
  await expect(main.getByText('Hibiki does not verify your age')).toBeVisible();

  await main.getByLabel('Name').fill('Learner');
  await main.getByLabel('Email').fill('learner@example.com');
  await main.getByLabel('Password', { exact: true }).fill('a long registration password');
  await main.getByRole('button', { name: 'Create account' }).click();
  expect(await confirmation.evaluate((input: HTMLInputElement) => input.validity.valid)).toBe(
    false,
  );
  expect(signUps).toHaveLength(0);

  await confirmation.check();
  await expect(google).toBeEnabled();
  await google.click();
  await expect(main.getByText('Google is unavailable in tests.')).toBeVisible();
  expect(social).toHaveLength(1);
  expect(social[0]).toMatchObject({
    provider: 'google',
    requestSignUp: true,
    additionalData: { adultConfirmed: true },
  });

  await main.getByRole('button', { name: 'Create account' }).click();
  await expect(main.getByText('Check your email to verify your account')).toBeVisible();
  expect(signUps).toHaveLength(1);
  expect(signUps[0]).toMatchObject({ email: 'learner@example.com', adultConfirmed: true });
});

test('Google sign-in never requests sign-up and explains when no account exists', async ({
  page,
}) => {
  await signedOut(page);
  const social: Record<string, unknown>[] = [];
  await page.route('**/api/auth/sign-in/social', (route) => {
    social.push(route.request().postDataJSON());
    return route.fulfill({ status: 400, json: { message: 'Google is unavailable in tests.' } });
  });
  await page.goto('/sign-in?error=signup_disabled');
  const main = page.getByRole('main');
  await expect(main.getByText('No Hibiki account uses this Google account yet.')).toBeVisible();
  await expect(main.getByRole('checkbox')).toHaveCount(0);
  await main.getByRole('button', { name: 'Continue with Google' }).click();
  await expect.poll(() => social.length).toBe(1);
  expect(social[0].requestSignUp).toBeUndefined();
  expect(social[0].additionalData).toBeUndefined();
});

const existing: AccountUser = {
  id: 'existing-learner',
  email: 'existing@example.com',
  name: 'Existing learner',
  emailVerified: true,
  adultConfirmed: false,
  plan: 'pro',
};

async function existingAccount(page: Page) {
  await mockDiscoverSync(page);
  const state = { user: { ...existing } as AccountUser | null, bootstraps: 0, confirmations: 0 };
  await page.addInitScript((userId) => {
    localStorage.setItem(
      `hibiki:v1:account:${userId}:sync:import-decision`,
      JSON.stringify('declined'),
    );
  }, existing.id);
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: state.user, googleEnabled: false, emailEnabled: true } }),
  );
  await page.route('**/api/sync/bootstrap*', (route) => {
    state.bootstraps++;
    return route.fulfill({ json: { data: emptySync(), nextCursor: null } });
  });
  await page.route('**/api/sync/push', (route) => route.fulfill({ json: { ok: true } }));
  await page.route('**/api/account/eligibility', (route) => {
    expect(route.request().postDataJSON()).toEqual({ adultConfirmed: true });
    state.confirmations++;
    state.user = { ...existing, adultConfirmed: true };
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/api/auth/sign-out', (route) => {
    state.user = null;
    return route.fulfill({ json: { success: true } });
  });
  return state;
}

test('an existing account confirms 18+ before anything syncs, without losing data', async ({
  page,
}) => {
  const state = await existingAccount(page);
  await page.goto('/');
  const gate = page.getByRole('region', { name: /Hibiki accounts are for adults aged 18/ });
  await expect(gate).toBeVisible();
  await expect(gate.getByText('Your saved progress has not been removed.')).toBeVisible();
  expect(state.bootstraps).toBe(0);
  await gate.getByRole('button', { name: 'I am 18 or older' }).click();
  await expect(gate).toBeHidden();
  expect(state.confirmations).toBe(1);
  await expect.poll(() => state.bootstraps).toBeGreaterThan(0);
});

test('an existing account holder under 18 can sign out from the confirmation prompt', async ({
  page,
}) => {
  const state = await existingAccount(page);
  await page.goto('/');
  const gate = page.getByRole('region', { name: /Hibiki accounts are for adults aged 18/ });
  await gate.getByRole('button', { name: 'I am under 18 — sign out' }).click();
  await expect(gate).toBeHidden();
  expect(state.confirmations).toBe(0);
  expect(state.bootstraps).toBe(0);
});
