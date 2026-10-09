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
    await page.goto('/words');
    const trigger = page.getByRole('button', { name: 'Open navigation menu' });
    await trigger.click();
    const menu = page.getByRole('dialog', { name: 'Navigate Hibiki' });
    await expect(menu).toBeVisible();
    for (const name of ['Home', 'Vocabulary', 'Profile', 'Sign in'])
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
    const views = page.getByRole('navigation', { name: 'Vocabulary' });
    await expect(views.getByRole('link', { name: 'Words', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(views.getByRole('link', { name: 'Review', exact: true })).toHaveAttribute(
      'href',
      '/review',
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

test('three desktop sections and profile aliases keep account and plan information accessible', async ({
  context,
  page,
}) => {
  await services(context, { user });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  await expect(nav.getByRole('link')).toHaveCount(3);
  for (const [name, href] of [
    ['Home', '/'],
    ['Vocabulary', '/review'],
    ['Profile', '/profile'],
  ])
    await expect(nav.getByRole('link', { name, exact: true })).toHaveAttribute('href', href);
  await nav.getByRole('link', { name: 'Profile', exact: true }).click();
  for (const route of ['/profile', '/account', '/progress']) {
    await page.goto(route);
    await expect(page.getByRole('heading', { name: 'Your progress', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
    await expect(page.getByText(user.email, { exact: true })).toBeVisible();
    await expect(page.getByText(/Email and password/)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Free and Pro' })).toBeVisible();
    await expect(page.getByText(/Online subscriptions are not available yet/)).toBeVisible();
  }
});
