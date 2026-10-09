import { expect, test, type BrowserContext } from '@playwright/test';
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import type { WordKnowledgeRecord } from '../../src/lib/knowledge/types';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { transcriptKey } from '../../src/lib/transcript';
import { lessonIdentity } from '../../src/lib/learner-progress';
import { lessonSyncId } from '../../src/lib/sync/validation';
import type { Lesson } from '../../src/lib/types';
import { emptyReview } from '../../src/lib/review/local';
import { mockDiscoverSync } from '../helpers/discover-account';

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
  await mockDiscoverSync(context);
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
  await context.route('**/api/review', (route) => {
    if (!state.user || route.request().headers()['x-hibiki-account'] !== state.user.id)
      return route.fulfill({ status: 409, json: { error: 'Account changed' } });
    return route.fulfill({ json: emptyReview() });
  });
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

test('a prior account POST cannot clear the new account outbox while its response body is parsing', async ({
  context,
  page,
}) => {
  const next = { ...user, id: 'knowledge-account-two', email: 'second@example.com' };
  const state: { user: AccountUser | null } = { user };
  await services(context, state);
  let nextPosts = 0;
  await context.route('**/api/knowledge*', async (route) => {
    if (
      route.request().headers()['x-hibiki-account'] === next.id &&
      route.request().method() === 'POST'
    ) {
      nextPosts++;
      return route.fulfill({ status: 503, json: { error: 'Offline fixture' } });
    }
    return route.fallback();
  });
  await context.addInitScript(
    ({ user, next, record }) => {
      localStorage.setItem('hibiki:v1:active-account', JSON.stringify(user.id));
      for (const owner of [user.id, next.id]) {
        localStorage.setItem(
          `hibiki:v1:account:${owner}:sync:import-decision`,
          JSON.stringify('declined'),
        );
        localStorage.setItem(
          `hibiki:v1:account:${owner}:knowledge:records`,
          JSON.stringify([record]),
        );
        localStorage.setItem(
          `hibiki:v1:account:${owner}:knowledge:outbox`,
          JSON.stringify([record]),
        );
      }
      const globals = window as unknown as { bodyWaiting?: boolean; releaseBody?: () => void };
      const originalFetch = window.fetch.bind(window);
      window.fetch = async (input, init) => {
        const response = await originalFetch(input, init);
        const headers = new Headers(init?.headers);
        if (
          String(input).includes('/api/knowledge') &&
          init?.method === 'POST' &&
          headers.get('X-Hibiki-Account') === user.id &&
          !globals.bodyWaiting
        ) {
          const originalJson = response.json.bind(response);
          response.json = async () => {
            const data = await originalJson();
            globals.bodyWaiting = true;
            await new Promise<void>((resolve) => {
              globals.releaseBody = resolve;
            });
            return data;
          };
        }
        return response;
      };
    },
    { user, next, record: anonymousWord },
  );
  await page.goto('/account');
  await expect
    .poll(() => page.evaluate(() => !!(window as unknown as { bodyWaiting?: boolean }).bodyWaiting))
    .toBe(true);
  state.user = next;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hibiki:v1:active-account') ?? 'null')),
    )
    .toBe(next.id);
  await page.evaluate(() => (window as unknown as { releaseBody?: () => void }).releaseBody?.());
  // A fresh B attempt proves that A finished its body read; the failed B write must remain durable.
  await expect.poll(() => nextPosts).toBeGreaterThan(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        JSON.parse(
          localStorage.getItem('hibiki:v1:account:knowledge-account-two:knowledge:outbox') ?? '[]',
        ),
      ),
    )
    .toEqual([anonymousWord]);
});

test('switching account during accepted-import hydration preserves the new account consent candidate', async ({
  context,
  page,
}) => {
  const next = { ...user, id: 'knowledge-account-two', email: 'second@example.com' };
  const state: { user: AccountUser | null } = { user };
  await services(context, state);
  const key = await transcriptKey(demo as Lesson);
  const identity = lessonIdentity(demo as Lesson, key);
  const candidate = {
    ...emptySync(),
    lessons: [
      {
        id: lessonSyncId(demo.id, key),
        lesson: identity,
        contentKey: null,
        providerMediaId: null,
        mediaAvailable: true,
        lastSectionId: null,
        position: 0,
        updatedAt: new Date().toISOString(),
        completed: false,
        completedAt: null,
      },
    ],
  };
  const nextWord = { ...anonymousWord, lemma: '朝', reading: 'あさ' };
  await context.addInitScript(
    ({ user, next, candidate, firstWord, nextWord }) => {
      localStorage.setItem('hibiki:v1:active-account', JSON.stringify(user.id));
      for (const owner of [user.id, next.id]) {
        localStorage.setItem(
          `hibiki:v1:account:${owner}:sync:import-candidate`,
          JSON.stringify(
            owner === user.id
              ? candidate
              : {
                  preferences: null,
                  lessons: [],
                  sessions: [],
                  attempts: [],
                  bookmarks: [],
                  difficulties: [],
                  archives: [],
                },
          ),
        );
        localStorage.setItem(
          `hibiki:v1:account:${owner}:sync:knowledge-import-candidate`,
          JSON.stringify([owner === user.id ? firstWord : nextWord]),
        );
      }
      const globals = window as unknown as {
        holdDigest?: boolean;
        digestWaiting?: boolean;
        releaseDigest?: () => void;
      };
      const originalDigest = crypto.subtle.digest.bind(crypto.subtle);
      crypto.subtle.digest = async (algorithm, data) => {
        if (globals.holdDigest && !globals.digestWaiting) {
          globals.digestWaiting = true;
          await new Promise<void>((resolve) => {
            globals.releaseDigest = resolve;
          });
        }
        return originalDigest(algorithm, data);
      };
    },
    { user, next, candidate, firstWord: anonymousWord, nextWord },
  );
  await page.goto('/account');
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toBeVisible();
  await expect(page.getByText('Your progress is synced.', { exact: true })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { holdDigest?: boolean }).holdDigest = true;
  });
  await page.getByRole('button', { name: 'Add device progress' }).click();
  await expect
    .poll(() =>
      page.evaluate(() => !!(window as unknown as { digestWaiting?: boolean }).digestWaiting),
    )
    .toBe(true);
  state.user = next;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hibiki:v1:active-account') ?? 'null')),
    )
    .toBe(next.id);
  await page.evaluate(() =>
    (window as unknown as { releaseDigest?: () => void }).releaseDigest?.(),
  );
  await page.waitForTimeout(200);
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem(
          'hibiki:v1:account:knowledge-account-two:sync:knowledge-import-candidate',
        ) ?? '[]',
      ),
    ),
  ).toEqual([nextWord]);
  expect(
    await page.evaluate(() =>
      JSON.parse(
        localStorage.getItem('hibiki:v1:account:knowledge-account-two:sync:import-decision') ??
          'null',
      ),
    ),
  ).toBe(null);
});
