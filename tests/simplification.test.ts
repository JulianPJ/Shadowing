import assert from 'node:assert/strict';
import { test } from 'node:test';
import demo from '../src/data/demo.json';
import type { Lesson } from '../src/lib/types';
import { installMemoryStorage } from './helpers/memory-storage';
import { cachedRead, rateLimited, tooManyRequests } from '../src/lib/server/rate-limit';
import {
  loadLesson,
  recentLessons,
  saveLesson,
  saveLessonPosition,
} from '../src/lib/storage/lessons';
import { readStorage, writeStorage, writeStorageIfChanged } from '../src/lib/storage/browser';
import { newReview, scheduleReview } from '../src/lib/review-scheduler';
import { KNOWN_INTERVAL_DAYS, statusAfterGrade } from '../src/lib/vocabulary';
import { createElapsedStore } from '../src/components/practice/elapsed-store';

test('public routes fail open and inference fails closed when the limiter is unavailable', async () => {
  const request = new Request('https://hibiki.example/api/translate', {
    headers: { 'cf-connecting-ip': '203.0.113.9' },
  });
  const keys: string[] = [];
  const allow = { limit: async ({ key }: { key: string }) => (keys.push(key), { success: true }) };
  const deny = { limit: async () => ({ success: false }) };
  const broken = {
    limit: async () => {
      throw new Error('binding unavailable');
    },
  };
  assert.equal(await rateLimited(allow, request, { failClosed: true, route: 'translate' }), false);
  assert.equal(await rateLimited(deny, request, { failClosed: false }), true);
  assert.equal(await rateLimited(broken, request, { failClosed: false }), false);
  assert.equal(await rateLimited(broken, request, { failClosed: true }), true);
  assert.equal(await rateLimited(undefined, request, { failClosed: true }), true);
  await rateLimited(allow, request, { failClosed: true });
  // Equivalent path spellings share the handler's constant route budget.
  await rateLimited(allow, new Request('https://hibiki.example/api//translate', request), {
    failClosed: true,
    route: 'translate',
  });
  assert.deepEqual(keys, ['translate:203.0.113.9', '203.0.113.9', 'translate:203.0.113.9']);
  const response = tooManyRequests('Slow down.');
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('cached reads share one request within the window and never cache failures', async () => {
  let now = 0,
    reads = 0,
    fail = false;
  const read = cachedRead(
    async () => {
      reads++;
      if (fail) throw new Error('D1 unavailable');
      return reads;
    },
    60_000,
    () => now,
  );
  assert.equal(await read(), 1);
  now = 59_000;
  assert.equal(await read(), 1);
  now = 61_000;
  fail = true;
  await assert.rejects(read());
  fail = false;
  assert.equal(await read(), 3);
  assert.equal(reads, 3);
});

test('recent history stores references; section moves write only the position', () => {
  const memory = new Map<string, string>();
  const storage = installMemoryStorage(memory);
  const writes: string[] = [];
  const original = storage.setItem;
  storage.setItem = (key, value) => {
    writes.push(key);
    original(key, value);
  };
  const lesson = structuredClone(demo) as Lesson;
  saveLesson(lesson, 0);
  const history = JSON.parse(memory.get('hibiki:v1:history')!);
  assert.deepEqual(Object.keys(history[0].lesson), ['id']);
  writes.length = 0;
  saveLessonPosition(lesson.id, 5);
  saveLessonPosition(lesson.id, 5);
  assert.deepEqual(writes, [`hibiki:v1:position:${lesson.id}`]);
  const [recent] = recentLessons();
  assert.equal(recent.lesson.id, lesson.id);
  assert.equal(recent.lesson.segments.length, lesson.segments.length);
  assert.equal(recent.index, 5);
});

test('legacy history entries with embedded lessons keep working and move to the lesson key', () => {
  const memory = new Map<string, string>();
  installMemoryStorage(memory);
  const legacy = structuredClone(demo) as Lesson;
  const other = { ...structuredClone(demo), id: 'other-lesson' } as Lesson;
  // Before references, history embedded full lessons and might be the only copy.
  writeStorage('history', [{ lesson: legacy, index: 3, updatedAt: 1 }]);
  assert.equal(loadLesson(legacy.id), null);
  assert.equal(recentLessons()[0].lesson.segments.length, legacy.segments.length);
  assert.equal(recentLessons()[0].index, 3);
  saveLesson(other, 0);
  const history = readStorage<{ lesson: { id: string; segments?: unknown } }[]>('history', []);
  assert.deepEqual(
    history.map((item) => item.lesson.id),
    ['other-lesson', legacy.id],
  );
  assert.ok(history.every((item) => !('segments' in item.lesson)));
  assert.equal(loadLesson(legacy.id)?.segments.length, legacy.segments.length);
});

test('storage writes notify once per real change and parse the previous value on demand', () => {
  installMemoryStorage();
  const target = new EventTarget();
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: target });
  const events: { key: string; previous: unknown; value: unknown }[] = [];
  target.addEventListener('hibiki:local-write', (event) => {
    const { key, previous, value } = (
      event as CustomEvent<{ key: string; previous: unknown; value: unknown }>
    ).detail;
    events.push({ key, previous, value });
  });
  try {
    writeStorage('favorites:demo', ['a']);
    writeStorage('favorites:demo', ['a']);
    writeStorageIfChanged('favorites:demo', ['a']);
    writeStorage('favorites:demo', ['a', 'b']);
    writeStorage('preferences', null);
    assert.deepEqual(events, [
      { key: 'favorites:demo', previous: null, value: ['a'] },
      { key: 'favorites:demo', previous: ['a'], value: ['a', 'b'] },
    ]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});

test('grading keeps word status in step without overriding Ignored', () => {
  const at = '2026-10-01T00:00:00.000Z';
  const young = {
    ...newReview('w', at),
    status: 'review' as const,
    intervalDays: 10,
    repetitions: 3,
  };
  const mature = scheduleReview(young, 'good', at);
  assert.ok(mature.intervalDays >= KNOWN_INTERVAL_DAYS);
  assert.equal(statusAfterGrade(young, mature, 'learning'), 'known');
  assert.equal(statusAfterGrade(young, mature, undefined), 'known');
  assert.equal(statusAfterGrade(young, mature, 'known'), null);
  assert.equal(statusAfterGrade(young, mature, 'ignored'), null);
  const short = scheduleReview(newReview('w', at), 'good', at);
  assert.equal(statusAfterGrade(newReview('w', at), short, 'learning'), null);
  const lapse = scheduleReview(mature, 'again', mature.dueAt);
  assert.equal(lapse.status, 'learning');
  assert.equal(statusAfterGrade(mature, lapse, 'known'), 'learning');
  assert.equal(statusAfterGrade(mature, lapse, 'ignored'), null);
});

test('the elapsed store only notifies subscribers of real changes', () => {
  const store = createElapsedStore(1);
  let calls = 0;
  const unsubscribe = store.subscribe(() => calls++);
  store.set(1);
  store.set(2.5);
  assert.equal(store.get(), 2.5);
  unsubscribe();
  store.set(3);
  assert.equal(calls, 1);
});
