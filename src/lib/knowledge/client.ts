'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { createSyncChannel } from '../sync/channel';
import { mergeKnowledge, normalizeLemma, validateKnowledgeRecord } from './validation';
import type { KnowledgeStates, WordKnowledgeRecord, WordState, KnowledgePage } from './types';

const SYNCED_THROUGH_KEY = 'knowledge:synced-through';
const PULL_OVERLAP_MS = 60_000;

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

function persistRecords(records: WordKnowledgeRecord[]) {
  if (
    !writeStorage(
      'knowledge:records',
      Object.values(mergeKnowledge(records, Object.values(loadKnowledge()))),
    )
  )
    throw new Error('Word states could not be saved on this device.');
}

export const knowledgeSync = createSyncChannel({
  channel: 'knowledge',
  pending: knowledgePending,
  async run({ request }) {
    const pending = outbox();
    for (let offset = 0; offset < pending.length; offset += 100) {
      const batch = pending.slice(offset, offset + 100);
      const accepted = await request<{ records?: unknown[] }>('/api/knowledge', {
        body: { records: batch },
      });
      // Adopt the server's value for each upload, including ones a newer device write beat.
      const stored = (accepted.records ?? []).map(validateKnowledgeRecord);
      if (stored.length) persistRecords(stored);
      const sent = new Map(batch.map((record) => [record.lemma, record.updatedAt]));
      writeStorage(
        'knowledge:outbox',
        outbox().filter((record) => sent.get(record.lemma) !== record.updatedAt),
      );
      publish();
    }
    // Pull only what the server changed since the previous pull. The overlap re-reads writes
    // committed while that pull was running; merging is idempotent last-writer-wins.
    const previous = readStorage<string | null>(SYNCED_THROUGH_KEY, null);
    const since =
      previous && Number.isFinite(Date.parse(previous))
        ? new Date(Date.parse(previous) - PULL_OVERLAP_MS).toISOString()
        : null;
    let cursor: string | null = null;
    let syncedThrough: string | null = null;
    const records: WordKnowledgeRecord[] = [];
    let pages = 0;
    do {
      const query = new URLSearchParams({
        ...(cursor ? { cursor } : {}),
        ...(since ? { since } : {}),
      }).toString();
      const page: KnowledgePage = await request('/api/knowledge' + (query ? '?' + query : ''));
      syncedThrough ??= page.syncedThrough ?? null;
      records.push(...page.records.map(validateKnowledgeRecord));
      if (++pages > 1000 || records.length > 250000)
        throw new Error('Word state collection too large');
      if (page.nextCursor === cursor && cursor) throw new Error('Invalid word state cursor');
      cursor = page.nextCursor;
    } while (cursor);
    if (records.length) persistRecords(records);
    // Only advance the watermark once the pulled records are durably stored.
    if (syncedThrough) writeStorage(SYNCED_THROUGH_KEY, syncedThrough);
    publish();
  },
});

/** Pushes local word states and pulls remote changes. Failures stay queued for the next run. */
export const syncWordKnowledge = () => knowledgeSync.sync().catch(() => {});
