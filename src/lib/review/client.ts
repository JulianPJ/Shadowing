'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus } from '../sync/client';
import { applyLocalReview, emptyReview } from './local';
import type { ReviewOperation, ReviewSnapshot } from './types';
let running: Promise<void> | null = null;
const notify = () => window.dispatchEvent(new Event('hibiki:review-change'));
export const cachedReview = () => readStorage<ReviewSnapshot>('review:data', emptyReview());
export const pendingReview = () => readStorage<ReviewOperation[]>('review:pending', []);
async function request(owner: string, operation?: ReviewOperation) {
  const response = await fetch('/api/review', {
    method: operation ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      'X-Hibiki-Account': owner,
      ...(operation ? { 'Content-Type': 'application/json' } : {}),
    },
    body: operation ? JSON.stringify(operation) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    const data = (await response.json()) as { code?: string; error?: string };
    const conflict = response.status === 409 && data.code === 'review-conflict';
    const error = new Error(
      conflict
        ? 'A review changed on another device. Refresh to use the latest schedule.'
        : 'Review changes are saved on this device and waiting to sync.',
    );
    Object.assign(error, { status: response.status, conflict });
    throw error;
  }
  return response.json();
}
export function changeReview(op: ReviewOperation) {
  if ('entryIds' in op && op.entryIds.length > 100) {
    for (let i = 0; i < op.entryIds.length; i += 100)
      changeReview({ ...op, entryIds: op.entryIds.slice(i, i + 100) });
    return;
  }
  if (!syncStatus().user || syncStatus().user?.id !== storageAccount())
    throw new Error('Sign in to review.');
  const data = applyLocalReview(cachedReview(), op);
  // Persist operations before optimistic state so interrupted writes remain replayable.
  writeStorage('review:pending', [...pendingReview(), op]);
  writeStorage('review:data', data);
  notify();
  void refreshReview().catch(() => {});
}
export async function refreshReview(): Promise<void> {
  if (running) return running;
  const owner = syncStatus().user?.id;
  if (!owner || owner !== storageAccount()) return;
  const current = () => owner === storageAccount() && syncStatus().user?.id === owner;
  const synchronize = async () => {
    while (current() && pendingReview().length) {
      const op = pendingReview()[0];
      try {
        await request(owner, op);
      } catch (error) {
        if (current() && (error as { conflict?: boolean }).conflict) {
          // Stop dependent grades; remote state wins. Keep conflict visible until acknowledged.
          writeStorage(
            'review:pending',
            pendingReview()
              .slice(1)
              .filter((p) => !('entryId' in p && 'entryId' in op && p.entryId === op.entryId)),
          );
          writeStorage(
            'review:conflict',
            'A review changed on another device. Its latest schedule was restored.',
          );
          const remote = (await request(owner)) as ReviewSnapshot;
          if (current())
            writeStorage('review:data', pendingReview().reduce(applyLocalReview, remote));
          notify();
        }
        throw error;
      }
      if (!current()) return;
      const pending = pendingReview();
      if (JSON.stringify(pending[0]) === JSON.stringify(op))
        writeStorage('review:pending', pending.slice(1));
    }
    const remote = (await request(owner)) as ReviewSnapshot;
    if (!current()) return;
    writeStorage('review:data', pendingReview().reduce(applyLocalReview, remote));
    notify();
  };
  // Tabs share the account outbox. Serialize network drains to avoid dropping an unsent operation.
  const drain = async () => {
    if (navigator.locks) await navigator.locks.request(`hibiki-review:${owner}`, synchronize);
    else await synchronize();
  };
  running = drain().finally(() => {
    running = null;
  });
  return running;
}
export function startReviewSync() {
  const refresh = () => {
    if (!document.hidden) void refreshReview().catch(() => {});
  };
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  window.addEventListener('hibiki:sync-hydrated', refresh);
  const timer = setInterval(refresh, 60000);
  return () => {
    clearInterval(timer);
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
    window.removeEventListener('hibiki:sync-hydrated', refresh);
  };
}
