import { expect, test, type BrowserContext } from '@playwright/test';
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import type { WordKnowledgeRecord } from '../../src/lib/knowledge/types';

const user: AccountUser = {
  id: 'knowledge-account-one',
  email: 'words@example.com',
  name: 'Word learner',
  emailVerified: true,
  plan: 'free',
};
const anonymousWord: WordKnowledgeRecord = {
  lemma: '勉強',
  reading: 'べんきょう',
  state: 'known',
  updatedAt: '2026-10-06T09:00:00.000Z',
};

async function services(context: BrowserContext, state: { user: AccountUser | null }) {
  const remote = new Map<string, WordKnowledgeRecord[]>();
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
  await context.route('**/api/knowledge*', (route) => {
    const owner = route.request().headers()['x-hibiki-account'];
    if (!state.user || owner !== state.user.id)
      return route.fulfill({ status: 409, json: { error: 'Account changed' } });
    if (route.request().method() === 'POST') {
      remote.set(owner, route.request().postDataJSON().records);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { records: remote.get(owner) ?? [], nextCursor: null } });
  });
  await context.addInitScript((record) => {
    if (localStorage.getItem('knowledge-test-seeded')) return;
    localStorage.setItem('knowledge-test-seeded', 'true');
    localStorage.setItem('hibiki:v1:knowledge:records', JSON.stringify([record]));
  }, anonymousWord);
  return remote;
}

test('word states import only after consent and stay isolated across accounts and sign-out', async ({
  context,
  page,
}) => {
  const state: { user: AccountUser | null } = { user: null };
  const remote = await services(context, state);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  state.user = user;
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toBeVisible();
  await expect(page.getByText('word knowledge states', { exact: false })).toBeVisible();
  expect(remote.get(user.id) ?? []).toEqual([]);
  await page.getByRole('button', { name: 'Add device progress' }).click();
  await expect.poll(() => remote.get(user.id)).toEqual([anonymousWord]);
  const next = { ...user, id: 'knowledge-account-two', email: 'second@example.com' };
  state.user = next;
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hibiki:v1:active-account') ?? 'null')),
    )
    .toBe(next.id);
  expect(remote.get(next.id) ?? []).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('hibiki:v1:account:knowledge-account-two:knowledge:records') ?? '[]',
      ),
    ),
  ).toEqual([]);
  state.user = null;
  await page.reload();
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hibiki:v1:active-account') ?? 'null')),
    )
    .toBe(null);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('hibiki:v1:knowledge:records') ?? '[]'),
    ),
  ).toEqual([anonymousWord]);
});

test('declining device import never sends anonymous vocabulary states', async ({
  context,
  page,
}) => {
  const state: { user: AccountUser | null } = { user: null };
  const remote = await services(context, state);
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Your account' })).toBeVisible();
  state.user = user;
  await page.reload();
  await page.getByRole('button', { name: 'Keep it on this device' }).click();
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toHaveCount(0);
  expect(remote.get(user.id) ?? []).toEqual([]);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem('hibiki:v1:knowledge:records') ?? '[]'),
    ),
  ).toEqual([anonymousWord]);
});
