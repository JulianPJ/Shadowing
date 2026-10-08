'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus } from '../sync/client';
import { channelStatus, reportChannel, syncFailure } from '../sync/channel-status';
import { applyLocalReview, emptyReview } from './local';
import type { ReviewOperation, ReviewSnapshot } from './types';
import { rememberReview, forgetReview, reconcileReviewHistory } from './history';
const running = new Map<string, Promise<void>>();
const notify = () => {
  const owner = storageAccount();
  if (owner) {
    const pending = pendingReview().length;
    const conflict = readStorage('review:conflict', '');
    reportChannel(owner, 'review', {
      pending,
      ...(conflict
        ? { state: 'conflict', message: conflict }
        : pending && channelStatus().review.state === 'saved'
          ? { state: 'pending' }
          : {}),
    });
  }
  window.dispatchEvent(new Event('hibiki:review-change'));
};
export function acknowledgeReviewConflict() {
  writeStorage('review:conflict', '');
  const owner = storageAccount();
  if (owner)
    reportChannel(owner, 'review', {
      state: pendingReview().length ? 'pending' : 'saved',
      message: '',
    });
  notify();
}
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
    const data = (await response.json().catch(() => ({}))) as { code?: string; error?: string };
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
  const before = cachedReview();
  const data = applyLocalReview(before, op);
  // Persist operations before optimistic state so interrupted writes remain replayable.
  writeStorage('review:pending', [...pendingReview(), op]);
  writeStorage('review:data', data);
  if (
    op.action === 'grade' &&
    before.cards.some(
      (card) =>
        card.entryId === op.entryId && card.revision === op.revision && card.status !== 'suspended',
    )
  )
    rememberReview({
      operationId: op.operationId,
      entryId: op.entryId,
      grade: op.grade,
      reviewedAt: op.reviewedAt,
      status: before.cards.find((card) => card.entryId === op.entryId)?.status as
        'new' | 'learning' | 'review',
    });
  notify();
  void refreshReview().catch(() => {});
}
export async function refreshReview(): Promise<void> {
  const owner = syncStatus().user?.id;
  if (!owner || owner !== storageAccount()) return;
  const active = running.get(owner);
  if (active) return active;
  const current = () => owner === storageAccount() && syncStatus().user?.id === owner;
  reportChannel(owner, 'review', {
    state: 'syncing',
    pending: pendingReview().length,
    message: '',
  });
  const synchronize = async () => {
    do {
      while (current() && pendingReview().length) {
        const op = pendingReview()[0];
        try {
          await request(owner, op);
        } catch (error) {
          if (current() && (error as { conflict?: boolean }).conflict) {
            // Stop dependent grades; remote state wins. Keep conflict visible until acknowledged.
            for (const discarded of pendingReview().filter(
              (p) => 'entryId' in p && 'entryId' in op && p.entryId === op.entryId,
            ))
              if (discarded.action === 'grade') forgetReview(discarded.operationId);
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
            if (current()) {
              reconcileReviewHistory(remote, pendingReview());
              writeStorage(
                'review:data',
                pendingReview().reduce(applyLocalReview, {
                  decks: remote.decks,
                  memberships: remote.memberships,
                  cards: remote.cards,
                }),
              );
            }
            notify();
          }
          throw error;
        }
        if (!current()) return;
        if (op.action === 'undo') forgetReview(op.targetOperationId);
        const pending = pendingReview();
        if (JSON.stringify(pending[0]) === JSON.stringify(op))
          writeStorage('review:pending', pending.slice(1));
      }
      const remote = (await request(owner)) as ReviewSnapshot;
      if (!current()) return;
      reconcileReviewHistory(remote, pendingReview());
      writeStorage(
        'review:data',
        pendingReview().reduce(applyLocalReview, {
          decks: remote.decks,
          memberships: remote.memberships,
          cards: remote.cards,
        }),
      );
      notify();
      // An edit can arrive while the final snapshot is in flight. Drain it under
      // the same lock instead of leaving it queued until the next focus/timer.
    } while (current() && pendingReview().length);
  };
  // Tabs share the account outbox. Serialize network drains to avoid dropping an unsent operation.
  const drain = async () => {
    if (navigator.locks) await navigator.locks.request(`hibiki-review:${owner}`, synchronize);
    else await synchronize();
  };
  const task = drain()
    .then(() => {
      if (current()) {
        const conflict = readStorage('review:conflict', '');
        reportChannel(owner, 'review', {
          state: conflict ? 'conflict' : 'saved',
          pending: pendingReview().length,
          lastSync: new Date().toISOString(),
          message: conflict,
        });
      }
    })
    .catch((error) => {
      if (current())
        reportChannel(owner, 'review', { ...syncFailure(error), pending: pendingReview().length });
      throw error;
    })
    .finally(() => {
      running.delete(owner);
    });
  running.set(owner, task);
  return task;
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
