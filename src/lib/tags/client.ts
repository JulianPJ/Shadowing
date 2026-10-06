'use client';
import { storageAccount, readStorage, writeStorage } from '../storage/browser';
import { dictionaryRequest } from '../dictionary/client';
import type { Tag, TagOperation } from './types';
export async function listTags() {
  const owner = storageAccount();
  try {
    const data = (await dictionaryRequest('/api/tags')) as { tags: Tag[] };
    if (owner !== storageAccount()) throw new Error('Account changed');
    writeStorage('dictionary:tags', data.tags);
    return data.tags;
  } catch (error) {
    if (owner === storageAccount() && !(error as { status?: number }).status)
      return readStorage<Tag[]>('dictionary:tags', []);
    if (owner === storageAccount() && (error as { status?: number }).status === 503)
      return readStorage<Tag[]>('dictionary:tags', []);
    throw error;
  }
}
export async function changeTags(operation: TagOperation) {
  const owner = storageAccount();
  if ('entryIds' in operation && operation.entryIds.length > 50) {
    for (let i = 0; i < operation.entryIds.length; i += 50) {
      if (owner !== storageAccount()) throw new Error('Account changed');
      await changeTags({ ...operation, entryIds: operation.entryIds.slice(i, i + 50) });
    }
    return;
  }
  const data = (await dictionaryRequest('/api/tags', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(operation),
  })) as { tags: Tag[] };
  if (owner !== storageAccount()) throw new Error('Account changed');
  writeStorage('dictionary:tags', data.tags);
  window.dispatchEvent(new Event('hibiki:dictionary-change'));
}
