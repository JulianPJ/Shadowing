import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cacheDictionary,
  cachedDictionary,
  deleteDictionaryCache,
  emptyDictionaryCache,
  mergeDictionaryCache,
  migrateDictionaryCache,
  DICTIONARY_CACHE_MAX,
  DICTIONARY_CACHE_BYTES,
} from '../src/lib/dictionary/cache';
import { setStorageAccount, readStorage, writeStorage } from '../src/lib/storage/browser';
import { installMemoryStorage } from './helpers/memory-storage';
import type { DictionaryEntry } from '../src/lib/dictionary/types';
export function entry(id = 'e', updatedAt = '2026-10-01T00:00:00.000Z'): DictionaryEntry {
  return {
    schemaVersion: 1,
    id,
    normalizedTerm: id,
    term: id,
    reading: null,
    translation: 'meaning',
    sourceSentence: '日本語',
    sourceSentenceTranslation: 'Japanese',
    source: {
      lessonId: 'lesson',
      segmentId: 's',
      lessonTitle: 'Lesson',
      lessonAuthor: 'Author',
      mediaType: 'demo',
      mediaId: null,
      mediaUrl: null,
      mediaContentKey: null,
      transcriptKey: 'a'.repeat(64),
      start: 0,
      end: 2,
    },
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt,
  };
}
test('paged cache merges by stable ID instead of replacing earlier pages', () => {
  let cache = mergeDictionaryCache(emptyDictionaryCache(), [entry('a'), entry('b')], 1);
  cache = mergeDictionaryCache(cache, [entry('b'), entry('c')], 2);
  assert.deepEqual(Object.keys(cache.records).sort(), ['a', 'b', 'c']);
  assert.equal(cache.records.b.observedAt, 2);
});
test('newer updates win while stale pages and same-date earlier requests cannot overwrite them', () => {
  let cache = mergeDictionaryCache(
    emptyDictionaryCache(),
    [{ ...entry('a', '2026-10-02T00:00:00.000Z'), translation: 'new' }],
    20,
  );
  cache = mergeDictionaryCache(cache, [entry('a')], 30);
  assert.equal(cache.records.a.entry.translation, 'new');
  cache = mergeDictionaryCache(
    cache,
    [{ ...entry('a', '2026-10-02T00:00:00.000Z'), translation: 'stale' }],
    10,
  );
  assert.equal(cache.records.a.entry.translation, 'new');
});
test('deletion removes cached material and fences late in-flight responses', () => {
  let cache = mergeDictionaryCache(emptyDictionaryCache(), [entry()], 1);
  cache = deleteDictionaryCache(cache, 'e', 4);
  cache = mergeDictionaryCache(cache, [entry()], 2);
  assert.equal(cache.records.e, undefined);
  assert.equal(cache.deleted.e, 4);
});
test('legacy array migrates in the same key and account switches isolate records', () => {
  installMemoryStorage();
  setStorageAccount('cache-a');
  writeStorage('dictionary:entries', [entry('legacy')]);
  cacheDictionary([entry('new')], 10);
  assert.equal(readStorage<{ version: number }>('dictionary:entries', { version: 0 }).version, 2);
  setStorageAccount('cache-b');
  assert.equal(Object.keys(cachedDictionary().records).length, 0);
  cacheDictionary([entry('other')], 11);
  setStorageAccount('cache-a');
  assert.deepEqual(Object.keys(cachedDictionary().records).sort(), ['legacy', 'new']);
  setStorageAccount(null);
  assert.equal(Object.keys(cachedDictionary().records).length, 0);
  assert.equal(migrateDictionaryCache([entry('old')]).records.old.entry.id, 'old');
});
test('review hydration survives browsing more pages and record/byte limits stay bounded', () => {
  let cache = mergeDictionaryCache(emptyDictionaryCache(), [entry('old-due')], 1, true);
  for (let page = 0; page < 10; page++)
    cache = mergeDictionaryCache(
      cache,
      Array.from({ length: 100 }, (_, i) => entry(`page-${page}-${i}`)),
      page + 2,
    );
  assert.ok(cache.records['old-due']);
  assert.ok(Object.keys(cache.records).length <= DICTIONARY_CACHE_MAX);
  cache = mergeDictionaryCache(
    cache,
    Array.from({ length: 250 }, (_, i) => ({
      ...entry('large-' + i),
      sourceSentence: '語'.repeat(5000),
      sourceSentenceTranslation: 'a'.repeat(10000),
    })),
    30,
  );
  assert.ok(cache.records['old-due']);
  assert.ok(
    Object.values(cache.records).reduce(
      (sum, r) => sum + new TextEncoder().encode(JSON.stringify(r)).length,
      0,
    ) <= DICTIONARY_CACHE_BYTES,
  );
});
