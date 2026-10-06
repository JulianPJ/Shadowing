'use client';
import type {
  DictionaryEntry,
  DictionarySaveInput,
  DictionaryQuery,
  DictionaryPage,
} from './types';
import { writeStorage, storageAccount } from '../storage/browser';
import { syncStatus } from '../sync/client';
import {
  cacheDictionary,
  cachedDictionary,
  cachedDictionaryQuery,
  deleteDictionaryCache,
} from './cache';
import { dictionaryQueryParams, validateDictionaryIds } from './query';

export async function dictionaryRequest(path: string, init?: RequestInit) {
  const owner = storageAccount();
  if (!owner || syncStatus().user?.id !== owner)
    throw new Error('Sign in to open your dictionary.');
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...init,
    headers: { ...init?.headers, 'X-Hibiki-Account': owner },
  });
  if (owner !== storageAccount() || syncStatus().user?.id !== owner)
    throw new Error('Account changed');
  const data = (await response.json()) as { error?: string };
  if (!response.ok)
    throw Object.assign(new Error(data.error || 'Your dictionary is unavailable right now.'), {
      status: response.status,
    });
  return data;
}
const canUseCache = (error: unknown) => {
  const e = error as { status?: number; message?: string };
  return (
    e.message !== 'Account changed' &&
    e.message !== 'Sign in to open your dictionary.' &&
    (!e.status || e.status >= 500)
  );
};
export async function dictionaryPage(
  query: DictionaryQuery = {},
  remoteOnly = false,
): Promise<DictionaryPage & { offline?: boolean }> {
  const owner = storageAccount(),
    startedAt = Date.now();
  try {
    const page = (await dictionaryRequest(
      '/api/dictionary?' + dictionaryQueryParams(query),
    )) as DictionaryPage;
    if (owner !== storageAccount()) throw new Error('Account changed');
    cacheDictionary(page.entries, startedAt);
    const cache = cachedDictionary();
    return {
      ...page,
      nextCursor: page.nextCursor ?? null,
      entries: page.entries
        .filter((e) => !cache.deleted[e.id])
        .map((e) => cache.records[e.id]?.entry ?? e),
    };
  } catch (error) {
    if (remoteOnly || owner !== storageAccount() || !canUseCache(error)) throw error;
    return { entries: cachedDictionaryQuery(query), nextCursor: null, offline: true };
  }
}
export async function dictionaryByIds(ids: string[], pin = true) {
  const valid = validateDictionaryIds(ids),
    owner = storageAccount(),
    startedAt = Date.now();
  try {
    const data = (await dictionaryRequest(
      '/api/dictionary?' + new URLSearchParams({ ids: valid.join(',') }),
    )) as { entries: DictionaryEntry[] };
    if (owner !== storageAccount()) throw new Error('Account changed');
    cacheDictionary(data.entries, startedAt, pin);
    const cache = cachedDictionary();
    return data.entries
      .filter((e) => !cache.deleted[e.id])
      .map((e) => cache.records[e.id]?.entry ?? e);
  } catch (error) {
    if (owner !== storageAccount() || !canUseCache(error)) throw error;
    const cache = cachedDictionary();
    return valid.flatMap((id) => (cache.records[id] ? [cache.records[id].entry] : []));
  }
}
/** Explicit full traversal for export/compatibility. Failure never yields a partial export. */
export async function listDictionary(query: DictionaryQuery = {}) {
  const owner = storageAccount(),
    entries = new Map<string, DictionaryEntry>();
  let cursor: string | null = null;
  do {
    if (owner !== storageAccount()) throw new Error('Account changed');
    const page = await dictionaryPage({ ...query, cursor }, true);
    for (const entry of page.entries) entries.set(entry.id, entry);
    cursor = page.nextCursor;
  } while (cursor);
  return [...entries.values()];
}
export async function saveDictionary(input: DictionarySaveInput) {
  const owner = storageAccount(),
    startedAt = Date.now();
  const data = (await dictionaryRequest('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', entry: input }),
  })) as { entry: DictionaryEntry };
  if (owner !== storageAccount()) throw new Error('Account changed');
  cacheDictionary([data.entry], startedAt);
  window.dispatchEvent(new Event('hibiki:dictionary-change'));
  return data.entry;
}
export async function removeDictionary(id: string) {
  const owner = storageAccount();
  await dictionaryRequest('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  });
  if (owner !== storageAccount()) return;
  writeStorage('dictionary:entries', deleteDictionaryCache(cachedDictionary(), id, Date.now()));
  window.dispatchEvent(new Event('hibiki:dictionary-change'));
}

export async function dictionaryTranslation(
  japanese: string,
  context?: { previousJapanese?: string; nextJapanese?: string },
  signal?: AbortSignal,
) {
  const response = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ japanese, ...context }),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  const data = (await response.json()) as { translation?: string; error?: string };
  if (!response.ok || typeof data.translation !== 'string' || !data.translation.trim())
    throw new Error(data.error || 'Translation is unavailable right now.');
  return data.translation.trim();
}
