'use client';
import type { DictionaryEntry, DictionarySaveInput } from './types';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus } from '../sync/client';

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...init,
    headers: {
      ...init?.headers,
      ...(syncStatus().user ? { 'X-Hibiki-Account': syncStatus().user!.id } : {}),
    },
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Your dictionary is unavailable right now.');
  return data;
}

export async function listDictionary() {
  const owner = storageAccount();
  try {
    const data = (await request('/api/dictionary')) as { entries: DictionaryEntry[] };
    if (owner !== storageAccount()) throw new Error('Account changed');
    writeStorage('dictionary:entries', data.entries);
    return data.entries;
  } catch (error) {
    const cached =
      owner === storageAccount()
        ? readStorage<DictionaryEntry[] | null>('dictionary:entries', null)
        : null;
    if (cached) return cached;
    throw error;
  }
}

export async function saveDictionary(input: DictionarySaveInput) {
  const owner = storageAccount();
  const data = (await request('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', entry: input }),
  })) as { entry: DictionaryEntry };
  if (owner !== storageAccount()) throw new Error('Account changed');
  writeStorage('dictionary:entries', [
    data.entry,
    ...readStorage<DictionaryEntry[]>('dictionary:entries', []).filter(
      (e) => e.id !== data.entry.id,
    ),
  ]);
  window.dispatchEvent(new Event('hibiki:dictionary-change'));
  return data.entry;
}

export async function removeDictionary(id: string) {
  const owner = storageAccount();
  await request('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  });
  if (owner !== storageAccount()) return;
  writeStorage(
    'dictionary:entries',
    readStorage<DictionaryEntry[]>('dictionary:entries', []).filter((e) => e.id !== id),
  );
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
