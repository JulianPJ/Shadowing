import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { PRO_FEATURES, canUseFeature, requirePro } from '../src/lib/access';
import { accountHandler } from '../src/lib/sync/server';
import { emptySync, type SyncData } from '../src/lib/sync/types';
import { basicSyncData } from '../src/lib/sync/access';
import { mergeSync } from '../src/lib/sync/merge';
import type { HibikiAuth } from '../src/lib/auth/server';
import { installMemoryStorage } from './helpers/memory-storage';
import { writeStorage, readStorage, setStorageAccount } from '../src/lib/storage/browser';
import { syncStatus } from '../src/lib/sync/client';
import { createSyncChannel } from '../src/lib/sync/channel';

test('all existing active-learning features require Pro, including anonymous access', () => {
  for (const feature of PRO_FEATURES) {
    assert.equal(canUseFeature(undefined, feature), false, feature);
    assert.equal(canUseFeature('free', feature), false, feature);
    assert.equal(canUseFeature('pro', feature), true, feature);
  }
});

test('direct paid AI route requests deny before providers, caches or rate-limit budgets', async () => {
  // Execute the actual route bodies with mocked runtime/providers, never real AI.
  for (const route of ['translate', 'difficulty', 'quiz', 'transcribe']) {
    const source = await readFile(`src/app/api/${route}/route.ts`, 'utf8');
    for (const plan of ['anonymous', 'free', 'pro']) {
      const status = plan === 'anonymous' ? 401 : plan === 'free' ? 403 : 200;
      const runtime = `
        export async function requireProAccess() { return ${status} === 200 ? null : Response.json({code:'pro-required'}, {status:${status}}); }
        export function sharedStorage() { throw Error('storage reached'); }
        export async function publicLimit() { throw Error('limit reached'); }
        export async function inferenceLimit() { throw Error('limit reached'); }
        export function limitedInference() { throw Error('provider reached'); }
        export const workerEnv = {DEEPL_AUTH_KEY: 'mock', AI: {}};
      `;
      const url = (js: string) =>
        `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`;
      const rewritten = source.replace(
        /import \{([^}]+)\} from '([^']+)';/g,
        (_, names: string, path: string) => {
          const body = path.endsWith('/runtime')
            ? runtime
            : names
                .split(',')
                .map(
                  (name) => `export function ${name.trim()}() { throw Error('provider reached'); }`,
                )
                .join('\n');
          return `import {${names}} from '${url(body)}';`;
        },
      );
      const compiled = ts.transpileModule(rewritten, {
        compilerOptions: { module: ts.ModuleKind.ESNext },
      }).outputText;
      const handler = await import(url(compiled));
      const request = new Request(`https://hibiki.example/api/${route}`, {
        method: 'POST',
        body: '{}',
      });
      if (plan === 'pro') await assert.rejects(handler.POST(request), /reached/);
      else assert.equal((await handler.POST(request)).status, status, `${route}: ${plan}`);
    }
  }
});

test('account gates preserve shared viewer sync and reject direct learning requests without touching repositories', async () => {
  let plan: 'free' | 'pro' = 'free';
  let reads = 0,
    writes = 0;
  const auth = {
    api: {
      getSession: async () => ({
        user: { id: 'learner', emailVerified: true, adultSelfDeclaredAt: new Date() },
      }),
    },
  } as unknown as HibikiAuth;
  let stored = emptySync();
  const handler = accountHandler({
    auth,
    env: { AUTH_BASE_URL: 'https://hibiki.example' },
    access: { plan: async () => plan },
    progress: {
      bootstrap: async () => {
        reads++;
        return { data: structuredClone(stored), nextCursor: null };
      },
      lesson: async () => {
        reads++;
        return null;
      },
      push: async (_, data) => {
        writes++;
        stored = mergeSync(stored, data);
      },
    },
    dictionary: {
      list: async () => [],
      page: async () => {
        reads++;
        return { entries: [], nextCursor: null };
      },
    } as never,
    review: {
      snapshot: async () => {
        reads++;
        return { cards: [], events: [] };
      },
    } as never,
    knowledge: {
      page: async () => {
        reads++;
        return { records: [], nextCursor: null };
      },
    } as never,
  });
  const request = (path: string, body?: unknown) =>
    new Request(`https://hibiki.example${path}`, {
      method: body ? 'POST' : 'GET',
      headers: { origin: 'https://hibiki.example', 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  for (const path of ['/api/dictionary', '/api/review', '/api/knowledge']) {
    for (const body of [undefined, { action: 'save', records: [] }]) {
      const response = await handler(request(path, body));
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, 'pro-required');
    }
  }
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  assert.equal((await handler(request('/api/sync/bootstrap'))).status, 200);
  assert.equal((await handler(request('/api/sync/push', emptySync()))).status, 200);
  assert.equal((await handler(request('/api/account/export'))).status, 200);
  plan = 'pro';
  for (const path of ['/api/dictionary', '/api/review', '/api/knowledge'])
    assert.equal((await handler(request(path))).status, 200);
  plan = 'free';
  const malicious = { ...emptySync(), sessions: [{ schemaVersion: 1 }] };
  assert.equal((await handler(request('/api/sync/push', malicious))).status, 400);
  assert.equal(writes, 1);
  assert.equal(
    await requirePro(request('/api/quiz'), auth, { plan: async () => plan }).then((r) => r?.status),
    403,
  );
});

test('Free hydration keeps existing local learning records intact', async () => {
  installMemoryStorage();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  const { hydrateSync } = await import('../src/lib/sync/hydrate');
  const prior = {
    sessions: [],
    archives: [{ retained: true }],
    difficulties: [{ retained: true }],
  };
  writeStorage('learner-history', prior);
  writeStorage('quiz-attempts', [{ retained: true }]);
  try {
    await hydrateSync(emptySync(), false);
    assert.deepEqual(readStorage('learner-history', null), prior);
    assert.deepEqual(readStorage('quiz-attempts', []), [{ retained: true }]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('Free skips learning channels but still runs Watch Later on the shared engine; Pro restores them', async () => {
  installMemoryStorage();
  const previous = syncStatus().user;
  setStorageAccount('paywall-user');
  syncStatus().user = {
    id: 'paywall-user',
    email: 'free@example.com',
    name: 'Learner',
    emailVerified: true,
    adultConfirmed: true,
    plan: 'free',
  };
  let learning = 0,
    watchLater = 0;
  try {
    const review = createSyncChannel({
      channel: 'review',
      pending: () => 1,
      run: async () => {
        learning++;
      },
    });
    const discover = createSyncChannel({
      channel: 'discovery',
      pending: () => 1,
      run: async () => {
        watchLater++;
      },
    });
    await review.sync();
    await discover.sync();
    assert.equal(learning, 0);
    assert.equal(watchLater, 1);
    syncStatus().user!.plan = 'pro';
    await review.sync();
    assert.equal(learning, 1);
  } finally {
    syncStatus().user = previous;
    setStorageAccount(null);
  }
});

test('Free sync cannot upload learning records from browser caches', () => {
  const input = {
    ...emptySync(),
    sessions: [{ preserved: true }],
    bookmarks: [{ preserved: true }],
  } as unknown as SyncData;
  const limited = basicSyncData(input);
  assert.equal(limited.sessions.length, 0);
  assert.equal(limited.bookmarks.length, 0);
  assert.equal(input.sessions.length, 1);
  assert.equal(input.bookmarks.length, 1);
});
