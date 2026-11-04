import type { AnkiPackage, ImportRecord, ImportResult } from './types';
import { dictionaryRequest } from '../dictionary/client';

export function inspectPackage(file: File): { promise: Promise<AnkiPackage>; cancel: () => void } {
  const worker = new Worker('/anki/import-worker.js');
  let rejectPending: (error: Error) => void = () => {};
  let timeout: ReturnType<typeof setTimeout>;
  const promise = new Promise<AnkiPackage>((resolve, reject) => {
    rejectPending = reject;
    timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Package analysis timed out. Export a smaller deck without media.'));
    }, 60000);
    const done = () => {
      clearTimeout(timeout);
      worker.terminate();
    };
    worker.onmessage = (event) => {
      done();
      if (event.data.error) reject(new Error(event.data.error));
      else resolve(event.data.data);
    };
    worker.onerror = () => {
      done();
      reject(new Error('Package analysis failed. Refresh and try a smaller export.'));
    };
    worker.postMessage({ file });
  });
  return {
    promise,
    cancel: () => {
      clearTimeout(timeout);
      worker.terminate();
      rejectPending(new Error('Package analysis cancelled.'));
    },
  };
}
export function importGroups(records: ImportRecord[]) {
  const groups: ImportRecord[][] = [];
  let group: ImportRecord[] = [];
  for (const r of records) {
    if (group.length === 3 || group.reduce((n, r) => n + r.decks.length, 0) + r.decks.length > 8) {
      groups.push(group);
      group = [];
    }
    group.push(r);
  }
  if (group.length) groups.push(group);
  return groups;
}
export async function sendImport(
  records: ImportRecord[],
  action: 'preview' | 'import',
  distinct: boolean,
) {
  return (await dictionaryRequest('/api/vocabulary/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records, action, distinct }),
  })) as ImportResult;
}
