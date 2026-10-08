import { expect, test, type BrowserContext } from '@playwright/test';
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import { emptyReview } from '../../src/lib/review/local';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { mockDiscoverSync } from '../helpers/discover-account';
const user: AccountUser = {
  id: 'navigation-learner',
  email: 'learner@example.com',
  name: 'Learner',
  emailVerified: true,
  plan: 'free',
};
async function services(
  context: BrowserContext,
  state: { user: AccountUser | null; reviewError?: number; knowledgeError?: number },
) {
  await mockDiscoverSync(context);
  await context.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: state.user, googleEnabled: false, emailEnabled: true } }),
  );
  await context.route('**/api/auth/list-accounts', (route) =>
    route.fulfill({ json: [{ providerId: 'credential' }] }),
  );
  await context.route('**/api/sync/bootstrap*', (route) =>
    route.fulfill({ json: { data: emptySync(), nextCursor: null } }),
  );
  await context.route('**/api/sync/push', (route) => route.fulfill({ json: { ok: true } }));
  await context.route('**/api/review', (route) =>
    route.fulfill({
      status: state.reviewError ?? 200,
      json: state.reviewError ? { error: 'Unavailable' } : emptyReview(),
    }),
  );
  await context.route('**/api/knowledge*', (route) =>
    route.fulfill({ status: state.knowledgeError ?? 200, json: { records: [], nextCursor: null } }),
  );
}

test('mobile menu is complete, restores focus and keeps learning-page return paths at narrow widths', async ({
  context,
  page,
}) => {
  await services(context, { user: null });
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/practice/demo');
    const trigger = page.getByRole('button', { name: 'Open navigation menu' });
    await trigger.click();
    const menu = page.getByRole('dialog', { name: 'Navigate Hibiki' });
    await expect(menu).toBeVisible();
    for (const name of ['Library', 'Vocabulary', 'Review', 'Progress', 'Sign in'])
      await expect(menu.getByRole('link', { name, exact: true })).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await page.goto('/dictionary');
    await expect(page.getByRole('link', { name: 'Back to practice', exact: true })).toHaveAttribute(
      'href',
      '/practice/demo',
    );
    const views = page.getByRole('navigation', { name: 'Vocabulary views' });
    await expect(views.getByRole('link', { name: 'Saved words', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(views.getByRole('link', { name: 'Word knowledge', exact: true })).toHaveAttribute(
      'href',
      '/words',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('email sign-in returns to the chosen word and section, with password visibility and safe callbacks', async ({
  context,
  page,
}) => {
  const state: { user: AccountUser | null } = { user: null };
  await services(context, state);
  let callback = '';
  await context.route('**/api/auth/sign-in/email', (route) => {
    callback = route.request().postDataJSON().callbackURL;
    state.user = user;
    return route.fulfill({ json: { user, session: { token: 'test-only' } } });
  });
  const destination = `/practice/demo?section=${encodeURIComponent(demo.segments[1].id)}&lookup=${encodeURIComponent('日本語')}`;
  await page.goto(`/sign-in?returnTo=${encodeURIComponent(destination)}`);
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('twelve-characters-plus');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`section=${demo.segments[1].id}.*lookup=`));
  expect(callback).toBe(destination);
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  state.user = null;
  await page.goto('/sign-in?returnTo=https%3A%2F%2Fevil.example');
  await page.getByLabel('Email', { exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('twelve-characters-plus');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);
  expect(callback).toBe('/account');
});

test('account drawer returns focus to practice and describes plans without a checkout promise', async ({
  context,
  page,
}) => {
  await services(context, { user });
  await page.goto('/practice/demo');
  const entry = page.getByRole('link', { name: 'Account', exact: true });
  await entry.click();
  const drawer = page.getByRole('dialog', { name: 'Your account' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Automatic sync' })).toBeVisible();
  await expect(drawer.getByText('Your progress is synced.', { exact: true })).toBeVisible();
  await expect(drawer.getByText(/Email and password/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(entry).toBeFocused();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
  await page.goto('/account#plans');
  await expect(page.getByRole('heading', { name: 'Free and Pro' })).toBeVisible();
  await expect(page.getByText(/Online subscriptions are not available yet/)).toBeVisible();
});

test('account never claims all data synced when word or review channels fail and offers accurate recovery', async ({
  context,
  page,
}) => {
  const state = { user, knowledgeError: 503, reviewError: 0 };
  await services(context, state);
  await page.goto('/account');
  const sync = page.getByRole('region', { name: 'Automatic sync' });
  await expect(sync.getByRole('status')).toContainText('The sync service is unavailable');
  await expect(page.getByText('Your progress is synced.', { exact: true })).toHaveCount(0);
  await expect(sync.getByRole('status')).not.toContainText('reconnect');
  state.knowledgeError = 0;
  state.reviewError = 401;
  await sync.getByRole('button', { name: 'Sync now' }).click();
  await expect(sync.getByRole('link', { name: 'Sign in again' })).toBeVisible();
  state.reviewError = 0;
  await sync.getByRole('button', { name: 'Sync now' }).click();
  await expect(sync.getByText('Your progress is synced.', { exact: true })).toBeVisible();
  await expect(sync.getByText(/Last synced/)).toBeVisible();
});
