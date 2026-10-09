import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMemoryStorage } from './helpers/memory-storage';
import { setStorageAccount } from '../src/lib/storage/browser';
import { syncStatus } from '../src/lib/sync/client';
import { AccountChanged, createSyncChannel } from '../src/lib/sync/channel';
import { channelStatus, sessionExpired, setChannelOwner } from '../src/lib/sync/channel-status';
import type { AccountUser } from '../src/lib/sync/types';

const user = (id: string, emailVerified = true): AccountUser => ({
  id,
  name: 'Learner',
  email: `${id}@example.com`,
  emailVerified,
  plan: 'free',
});
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function signedIn(id: string, run: () => Promise<void>, verified = true) {
  installMemoryStorage();
  const previousUser = syncStatus().user,
    originalFetch = globalThis.fetch;
  setStorageAccount(id);
  setChannelOwner(id);
  syncStatus().user = user(id, verified);
  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
    syncStatus().user = previousUser;
    setStorageAccount(null);
    setChannelOwner(null);
  }
}

test('one run at a time; calls during a run queue exactly one follow-up', () =>
  signedIn('a', async () => {
    let runs = 0,
      pending = 0;
    const gate = deferred();
    const channel = createSyncChannel({
      channel: 'knowledge',
      pending: () => pending,
      async run() {
        // Each run drains what was pending when it started.
        pending = 0;
        runs++;
        if (runs === 1) await gate.promise;
      },
    });
    const first = channel.sync();
    pending = 1;
    assert.equal(channel.sync(), first);
    assert.equal(channel.sync(), first);
    gate.resolve();
    await first;
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(runs, 2);
  }));

test('a forced request made during a run still runs afterwards with nothing pending', () =>
  signedIn('a', async () => {
    let runs = 0;
    const gate = deferred();
    const channel = createSyncChannel({
      channel: 'discovery',
      pending: () => 0,
      async run() {
        runs++;
        if (runs === 1) await gate.promise;
      },
    });
    const first = channel.sync();
    void channel.sync();
    void channel.sync({ force: true });
    void channel.sync();
    gate.resolve();
    await first;
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(runs, 2);
    // The forced follow-up leaves the channel fresh again for routine triggers.
    await channel.sync();
    assert.equal(runs, 2);
  }));

test('routine syncs reuse a fresh run unless something is pending or the caller forces', () =>
  signedIn('a', async () => {
    let runs = 0,
      pending = 0;
    const channel = createSyncChannel({
      channel: 'review',
      pending: () => pending,
      async run() {
        runs++;
      },
    });
    await channel.sync();
    await channel.sync();
    assert.equal(runs, 1);
    pending = 1;
    await channel.sync();
    assert.equal(runs, 2);
    pending = 0;
    await channel.sync({ force: true });
    assert.equal(runs, 3);
  }));

test('signed-out and unverified accounts never reach the network', async () => {
  let runs = 0;
  const channel = createSyncChannel({
    channel: 'discovery',
    pending: () => 1,
    async run() {
      runs++;
    },
  });
  installMemoryStorage();
  await channel.sync({ force: true });
  await signedIn('a', () => channel.sync({ force: true }), false);
  assert.equal(runs, 0);
});

test('a session rejected by the server is the one state that surfaces; failures are retried', () =>
  signedIn('a', async () => {
    let status = 401;
    globalThis.fetch = (async () =>
      ({ ok: status === 200, status, json: async () => ({}) }) as Response) as typeof fetch;
    const channel = createSyncChannel({
      channel: 'knowledge',
      pending: () => 0,
      run: ({ request }) => request('/api/knowledge').then(() => {}),
    });
    await assert.rejects(channel.sync(), (error: { status?: number }) => error.status === 401);
    assert.equal(sessionExpired(channelStatus()), true);
    status = 200;
    // A failed run is never treated as fresh.
    await channel.sync();
    assert.equal(channelStatus().knowledge.state, 'saved');
    assert.equal(sessionExpired(channelStatus()), false);
  }));

test('responses that arrive after an account switch are discarded and leave no fresh mark', () =>
  signedIn('a', async () => {
    const responded = deferred<Response>();
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1 ? responded.promise : ({ ok: true, json: async () => ({}) } as Response);
    }) as typeof fetch;
    let applied = false;
    const channel = createSyncChannel({
      channel: 'review',
      pending: () => 0,
      async run({ request }) {
        await request('/api/review');
        applied = true;
      },
    });
    const running = channel.sync();
    setStorageAccount('b');
    syncStatus().user = user('b');
    responded.resolve({ ok: true, json: async () => ({}) } as Response);
    await assert.rejects(running, AccountChanged);
    assert.equal(applied, false);
    setStorageAccount('a');
    syncStatus().user = user('a');
    await channel.sync();
    assert.equal(applied, true);
  }));
