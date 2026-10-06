'use client';
import type { DictionaryEntry, DictionarySaveInput } from './types';

async function request(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
    ...init,
  });
  const data = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(data.error || 'Your dictionary is unavailable right now.');
  return data;
}

export async function listDictionary() {
  const data = (await request('/api/dictionary')) as { entries: DictionaryEntry[] };
  return data.entries;
}

export async function saveDictionary(input: DictionarySaveInput) {
  const data = (await request('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'save', entry: input }),
  })) as { entry: DictionaryEntry };
  return data.entry;
}

export async function removeDictionary(id: string) {
  await request('/api/dictionary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete', id }),
  });
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
