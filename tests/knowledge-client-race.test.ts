import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMemoryStorage } from './helpers/memory-storage';
import { setStorageAccount, writeStorage } from '../src/lib/storage/browser';
import { loadKnowledge, syncWordKnowledge, knowledgePending } from '../src/lib/knowledge/client';
import { syncStatus } from '../src/lib/sync/client';
import type { AccountUser } from '../src/lib/sync/types';
import type { WordKnowledgeRecord } from '../src/lib/knowledge/types';

const user = (id: string): AccountUser => ({
  id,
  name: 'Learner',
  email: `${id}@example.com`,
  emailVerified: true,
  plan: 'free',
});
const word = (
  state: WordKnowledgeRecord['state'],
  updatedAt = new Date().toISOString(),
): WordKnowledgeRecord => ({ lemma: '朝', reading: 'あさ', state, updatedAt });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function setup(run: () => Promise<void>) {
  installMemoryStorage();
  const originalFetch = globalThis.fetch,
    previousUser = syncStatus().user;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  setStorageAccount('a');
  syncStatus().user = user('a');
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    syncStatus().user = previousUser;
    setStorageAccount(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
}
test('account switch while POST response JSON parses cannot clear another account outbox', async () =>
  setup(async () => {
    const sent = word('known'),
      started = deferred<void>(),
      json = deferred<unknown>();
    writeStorage('knowledge:records', [sent]);
    writeStorage('knowledge:outbox', [sent]);
    globalThis.fetch = (async (_input, init) => {
      assert.equal(init?.method, 'POST');
      return {
        ok: true,
        async json() {
          started.resolve();
          return json.promise;
        },
      } as Response;
    }) as typeof fetch;
    const running = syncWordKnowledge();
    await started.promise;
    setStorageAccount('b');
    syncStatus().user = user('b');
    const other = { ...sent, state: 'ignored' as const };
    writeStorage('knowledge:records', [other]);
    writeStorage('knowledge:outbox', [other]);
    json.resolve({ ok: true });
    await running;
    assert.equal(knowledgePending(), 1);
    assert.equal(loadKnowledge()['朝'].state, 'ignored');
    setStorageAccount('a');
    assert.equal(knowledgePending(), 1);
  }));
test('account switch while GET response JSON parses cannot hydrate foreign word states', async () =>
  setup(async () => {
    const started = deferred<void>(),
      json = deferred<unknown>();
    writeStorage('knowledge:records', []);
    writeStorage('knowledge:outbox', []);
    globalThis.fetch = (async () =>
      ({
        ok: true,
        async json() {
          started.resolve();
          return json.promise;
        },
      }) as Response) as typeof fetch;
    const running = syncWordKnowledge();
    await started.promise;
    setStorageAccount('b');
    syncStatus().user = user('b');
    writeStorage('knowledge:records', []);
    writeStorage('knowledge:outbox', []);
    json.resolve({ records: [word('known')], nextCursor: null });
    await running;
    assert.deepEqual(loadKnowledge(), {});
  }));
test('new local reset during sync survives a stale response and keeps its retry record', async () =>
  setup(async () => {
    const sent = word('known', new Date(Date.now() - 1000).toISOString());
    const started = deferred<void>(),
      json = deferred<unknown>();
    writeStorage('knowledge:records', [sent]);
    writeStorage('knowledge:outbox', [sent]);
    globalThis.fetch = (async (_input, init) =>
      init?.method === 'POST'
        ? ({
            ok: true,
            async json() {
              started.resolve();
              return json.promise;
            },
          } as Response)
        : ({
            ok: true,
            async json() {
              return { records: [sent], nextCursor: null };
            },
          } as Response)) as typeof fetch;
    const running = syncWordKnowledge();
    await started.promise;
    const reset = word('unknown');
    writeStorage('knowledge:records', [reset]);
    writeStorage('knowledge:outbox', [reset]);
    json.resolve({ ok: true });
    await running;
    assert.equal(knowledgePending(), 1);
    assert.equal(loadKnowledge()['朝'].state, 'unknown');
  }));
