import type { DictionaryEntry, DictionaryQuery } from './types';
import { readStorage, writeStorage } from '../storage/browser';
import { normalizeDictionaryTerm } from './validation';
export const DICTIONARY_CACHE_MAX = 700;
export const DICTIONARY_CACHE_BYTES = 3_000_000;
export const REVIEW_MATERIAL_MAX = 200;
type CachedRecord = { entry: DictionaryEntry; observedAt: number; pinnedAt: number | null };
export type DictionaryCache = {
  version: 2;
  records: Record<string, CachedRecord>;
  deleted: Record<string, number>;
};
export const emptyDictionaryCache = (): DictionaryCache => ({
  version: 2,
  records: {},
  deleted: {},
});
export function migrateDictionaryCache(
  value: DictionaryCache | DictionaryEntry[],
): DictionaryCache {
  if (Array.isArray(value)) return mergeDictionaryCache(emptyDictionaryCache(), value, 0);
  return value?.version === 2 && value.records && value.deleted ? value : emptyDictionaryCache();
}
export function mergeDictionaryCache(
  cache: DictionaryCache,
  entries: DictionaryEntry[],
  startedAt: number,
  pin = false,
): DictionaryCache {
  const next = structuredClone(cache);
  for (const entry of entries) {
    if (next.deleted[entry.id] !== undefined && next.deleted[entry.id] >= startedAt) continue;
    const old = next.records[entry.id];
    if (
      old &&
      (old.entry.updatedAt > entry.updatedAt ||
        (old.entry.updatedAt === entry.updatedAt && old.observedAt > startedAt))
    ) {
      if (pin) old.pinnedAt = startedAt;
      continue;
    }
    next.records[entry.id] = {
      entry,
      observedAt: startedAt,
      pinnedAt: pin ? startedAt : (old?.pinnedAt ?? null),
    };
    delete next.deleted[entry.id];
  }
  const ordered = Object.values(next.records).sort(
    (a, b) =>
      Number(b.pinnedAt !== null) - Number(a.pinnedAt !== null) ||
      (b.pinnedAt ?? b.observedAt) - (a.pinnedAt ?? a.observedAt) ||
      b.entry.id.localeCompare(a.entry.id),
  );
  let bytes = 0,
    pins = 0,
    count = 0;
  next.records = {};
  for (const record of ordered) {
    if (record.pinnedAt !== null && ++pins > REVIEW_MATERIAL_MAX) record.pinnedAt = null;
    const size = new TextEncoder().encode(JSON.stringify(record)).length;
    if (++count > DICTIONARY_CACHE_MAX || bytes + size > DICTIONARY_CACHE_BYTES) continue;
    bytes += size;
    next.records[record.entry.id] = record;
  }
  next.deleted = Object.fromEntries(
    Object.entries(next.deleted)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 700),
  );
  return next;
}
export function deleteDictionaryCache(cache: DictionaryCache, id: string, deletedAt: number) {
  const next = structuredClone(cache);
  delete next.records[id];
  next.deleted[id] = deletedAt;
  return next;
}
export const cachedDictionary = () =>
  migrateDictionaryCache(
    readStorage<DictionaryCache | DictionaryEntry[]>('dictionary:entries', []),
  );
export function cacheDictionary(entries: DictionaryEntry[], startedAt: number, pin = false) {
  const next = mergeDictionaryCache(cachedDictionary(), entries, startedAt, pin);
  writeStorage('dictionary:entries', next);
  return entries.map((e) => next.records[e.id]?.entry).filter((e): e is DictionaryEntry => !!e);
}
export function cachedDictionaryQuery(query: DictionaryQuery) {
  return Object.values(cachedDictionary().records)
    .map((r) => r.entry)
    .filter(
      (e) =>
        (!query.lessonId || e.source.lessonId === query.lessonId) &&
        (!query.transcriptKey || e.source.transcriptKey === query.transcriptKey) &&
        (!query.term || e.normalizedTerm === normalizeDictionaryTerm(query.term)) &&
        (!query.search ||
          [e.term, e.reading ?? '', e.translation].some((value) =>
            normalizeDictionaryTerm(value).includes(normalizeDictionaryTerm(query.search!)),
          )),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
}
