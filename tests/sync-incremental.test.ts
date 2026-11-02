import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { installMemoryStorage } from './helpers/memory-storage';
import { localProgressDatabase } from './helpers/sqlite-d1';
import { readStorage, setStorageAccount, writeStorage } from '../src/lib/storage/browser';
import { createD1UserProgressRepository } from '../src/lib/sync/repository';
import { synchronize, syncStatus } from '../src/lib/sync/client';
import { emptySync, type SyncData, type SyncedLesson } from '../src/lib/sync/types';
import { lessonIdentity } from '../src/lib/learner/constants';
import { transcriptKey } from '../src/lib/transcript';
import type { Lesson } from '../src/lib/types';
import demo from '../src/data/demo.json';

async function harness() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations')
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort())
    sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  sqlite.exec(
    `INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('a','Learner','a@example.com',1,0,0)`,
  );
  const repo = createD1UserProgressRepository(localProgressDatabase(sqlite));
  const calls: string[] = [];
  const server = { watermarks: true };
  globalThis.fetch = (async (input: string, init?: RequestInit) => {
    const url = new URL(input, 'https://hibiki.test');
    calls.push(`${url.pathname}${url.searchParams.has('since') ? '?since' : ''}`);
    if (url.pathname === '/api/sync/bootstrap') {
      // An older server ignores `since`, sends no watermark and returns no records from pushes.
      const page = await repo.bootstrap(
        'a',
        url.searchParams.get('cursor'),
        false,
        server.watermarks ? url.searchParams.get('since') : null,
      );
      return Response.json(server.watermarks ? page : { ...page, serverTime: undefined });
    }
    if (url.pathname === '/api/sync/push') {
      const stored = await repo.push('a', JSON.parse(String(init!.body)) as SyncData);
      return Response.json(server.watermarks ? { ok: true, data: stored } : { ok: true });
    }
    throw new Error(`Unexpected ${url.pathname}`);
  }) as typeof fetch;
  const key = await transcriptKey(demo);
  const lesson = (position: number, updatedAt = new Date().toISOString()): SyncedLesson => ({
    id: JSON.stringify(['demo', key]),
    lesson: lessonIdentity(demo as Lesson, key),
    contentKey: null,
    providerMediaId: null,
    mediaAvailable: true,
    lastSectionId: demo.segments[position].id,
    position,
    updatedAt,
    completed: false,
    completedAt: null,
  });
  return { repo, calls, server, lesson };
}

test('after a first full sync a device pulls only changes and pushes only what the server lacks', async () => {
  installMemoryStorage();
  const originalFetch = globalThis.fetch;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  setStorageAccount('a');
  syncStatus().user = {
    id: 'a',
    name: 'Learner',
    email: 'a@example.com',
    emailVerified: true,
    adultConfirmed: true,
    plan: 'pro',
  };
  try {
    const { repo, calls, server, lesson } = await harness();
    const synced = () => readStorage<SyncData>('sync:data', emptySync()).lessons;
    writeStorage('sync:data', { ...emptySync(), lessons: [lesson(2)] });
    await synchronize();
    // The push returns the stored record, so no second pull follows it.
    assert.deepEqual(calls.splice(0), ['/api/sync/bootstrap', '/api/sync/push']);
    assert.equal((await repo.bootstrap('a')).data.lessons[0].position, 2);

    await synchronize();
    assert.deepEqual(calls.splice(0), ['/api/sync/bootstrap?since'], 'nothing to push');

    // Another device moves on; this one adopts it from the changes alone.
    await repo.push('a', {
      ...emptySync(),
      lessons: [lesson(4, new Date(Date.now() + 1000).toISOString())],
    });
    await synchronize();
    assert.deepEqual(calls.splice(0), ['/api/sync/bootstrap?since']);
    assert.equal(synced()[0].position, 4);

    // A cache that lost records it had synced starts again from a full pull.
    writeStorage('sync:data', emptySync());
    await synchronize();
    assert.deepEqual(calls.splice(0), ['/api/sync/bootstrap']);
    assert.equal(synced()[0].position, 4);

    // A server without watermarks gets the original pull, push and pull, and later full pulls.
    server.watermarks = false;
    writeStorage('sync:data', {
      ...emptySync(),
      lessons: [lesson(5, new Date(Date.now() + 2000).toISOString())],
    });
    await synchronize();
    assert.deepEqual(calls.splice(0), [
      '/api/sync/bootstrap?since',
      '/api/sync/push',
      '/api/sync/bootstrap?since',
    ]);
    assert.equal(readStorage('sync:remote', 'unset'), null);
    assert.equal((await repo.bootstrap('a')).data.lessons[0].position, 5);
    await synchronize();
    assert.deepEqual(calls.splice(0), ['/api/sync/bootstrap']);
  } finally {
    globalThis.fetch = originalFetch;
    syncStatus().user = null;
    setStorageAccount(null);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
