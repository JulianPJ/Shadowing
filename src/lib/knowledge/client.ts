'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus, subscribeSync } from '../sync/client';
import { mergeKnowledge, normalizeLemma, validateKnowledgeRecord } from './validation';
import type { KnowledgeStates, WordKnowledgeRecord, WordState, KnowledgePage } from './types';

export function loadKnowledge(): KnowledgeStates {
  const raw = readStorage<unknown>('knowledge:records', []);
  return mergeKnowledge(Array.isArray(raw) ? raw : []);
}
function outbox(): WordKnowledgeRecord[] {
  const raw = readStorage<unknown>('knowledge:outbox', []);
  return Object.values(mergeKnowledge(Array.isArray(raw) ? raw : []));
}
export function knowledgePending() {
  return outbox().length;
}
function publish() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hibiki:knowledge-change'));
}
/** Called only after the existing first-login device import consent is accepted. */
export function importKnowledgeRecords(records: WordKnowledgeRecord[]) {
  if (!storageAccount()) return;
  const imported = Object.values(mergeKnowledge(records));
  writeStorage(
    'knowledge:records',
    Object.values(mergeKnowledge(Object.values(loadKnowledge()), imported)),
  );
  writeStorage('knowledge:outbox', Object.values(mergeKnowledge(outbox(), imported)));
  publish();
  void syncWordKnowledge();
}
export function markWords(words: { lemma: string; reading?: string | null }[], state: WordState) {
  const existing = loadKnowledge();
  const time = new Date(
    words.reduce((latest, word) => {
      const previous = Date.parse(existing[normalizeLemma(word.lemma)]?.updatedAt ?? '') + 1;
      return Number.isFinite(previous) ? Math.max(latest, previous) : latest;
    }, Date.now()),
  ).toISOString();
  const records = words.map((word) =>
    validateKnowledgeRecord({
      lemma: normalizeLemma(word.lemma),
      reading: word.reading ?? existing[normalizeLemma(word.lemma)]?.reading ?? null,
      state,
      updatedAt: time,
    }),
  );
  writeStorage(
    'knowledge:records',
    Object.values(mergeKnowledge(Object.values(existing), records)),
  );
  // Explicit anonymous states remain in the anonymous namespace. No account import is inferred.
  if (storageAccount())
    writeStorage('knowledge:outbox', Object.values(mergeKnowledge(outbox(), records)));
  publish();
  if (storageAccount()) void syncWordKnowledge();
}
let runningOwner: string | null = null,
  rerun = false;
export async function syncWordKnowledge() {
  const owner = storageAccount(),
    user = syncStatus().user;
  if (!owner || user?.id !== owner || !user.emailVerified) return;
  if (runningOwner) {
    rerun = true;
    return;
  }
  runningOwner = owner;
  const validOwner = () => storageAccount() === owner && syncStatus().user?.id === owner;
  async function request(cursor?: string | null, records?: WordKnowledgeRecord[]) {
    const response = await fetch(
      '/api/knowledge' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : ''),
      {
        method: records ? 'POST' : 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          'X-Hibiki-Account': owner!,
          ...(records ? { 'Content-Type': 'application/json' } : {}),
        },
        body: records ? JSON.stringify({ records }) : undefined,
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!validOwner()) throw new Error('Account changed');
    if (!response.ok) throw new Error('Word sync unavailable');
    const data = await response.json();
    if (!validOwner()) throw new Error('Account changed');
    return data;
  }
  try {
    const pending = outbox();
    for (let offset = 0; offset < pending.length; offset += 100) {
      if (!validOwner()) return;
      const batch = pending.slice(offset, offset + 100);
      await request(null, batch);
      if (!validOwner()) return;
      const sent = new Map(batch.map((record) => [record.lemma, record.updatedAt]));
      writeStorage(
        'knowledge:outbox',
        outbox().filter((record) => sent.get(record.lemma) !== record.updatedAt),
      );
      publish();
    }
    let cursor: string | null = null;
    const records: WordKnowledgeRecord[] = [];
    let pages = 0;
    do {
      if (!validOwner()) return;
      const page = (await request(cursor)) as KnowledgePage;
      records.push(...page.records.map(validateKnowledgeRecord));
      if (++pages > 1000 || records.length > 250000)
        throw new Error('Word state collection too large');
      if (page.nextCursor === cursor && cursor) throw new Error('Invalid word state cursor');
      cursor = page.nextCursor;
    } while (cursor);
    if (!validOwner()) return;
    writeStorage(
      'knowledge:records',
      Object.values(mergeKnowledge(records, Object.values(loadKnowledge()))),
    );
    publish();
  } catch {
    /* Durable local edits stay available, with retries on focus/online. */
  } finally {
    runningOwner = null;
    if (rerun) {
      rerun = false;
      void syncWordKnowledge();
    }
  }
}
let started = false;
export function startKnowledgeSync() {
  if (started) return () => {};
  started = true;
  let identity = '';
  const changed = () => {
    const user = syncStatus().user;
    const current = `${storageAccount() ?? ''}:${user?.id ?? ''}:${user?.emailVerified ?? false}`;
    if (current !== identity) {
      identity = current;
      publish();
      void syncWordKnowledge();
    }
  };
  const hydrate = () => {
    publish();
    void syncWordKnowledge();
  };
  const storage = (event: StorageEvent) => {
    if (event.key?.includes(':knowledge:')) hydrate();
  };
  const unsubscribe = subscribeSync(changed);
  window.addEventListener('hibiki:sync-hydrated', hydrate);
  window.addEventListener('online', hydrate);
  window.addEventListener('focus', hydrate);
  window.addEventListener('storage', storage);
  changed();
  return () => {
    started = false;
    unsubscribe();
    window.removeEventListener('hibiki:sync-hydrated', hydrate);
    window.removeEventListener('online', hydrate);
    window.removeEventListener('focus', hydrate);
    window.removeEventListener('storage', storage);
  };
}
