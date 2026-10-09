'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus } from '../sync/client';
import { createSyncChannel } from '../sync/channel';
import { applyLocalReview, emptyReview } from './local';
import { REVIEW_ACTIONS, type ReviewOperation, type ReviewSnapshot } from './types';
import { rememberReview, forgetReview, reconcileReviewHistory } from './history';
const notify = () => window.dispatchEvent(new Event('hibiki:review-change'));
export function acknowledgeReviewConflict() {
  writeStorage('review:conflict', '');
  notify();
}
export const cachedReview = () => readStorage<ReviewSnapshot>('review:data', emptyReview());
/** Deck and membership operations queued before decks were removed are dropped. */
export const pendingReview = () =>
  readStorage<ReviewOperation[]>('review:pending', []).filter((op) =>
    REVIEW_ACTIONS.includes(op?.action),
  );
const isConflict = (error: unknown) =>
  (error as { status?: number }).status === 409 &&
  (error as { data?: { code?: string } }).data?.code === 'review-conflict';
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
function applyRemote(remote: ReviewSnapshot) {
  reconcileReviewHistory(remote, pendingReview());
  writeStorage('review:data', pendingReview().reduce(applyLocalReview, { cards: remote.cards }));
}
/**
 * The review snapshot is the whole schedule, so routine refreshes reuse a recent pull. Queued
 * operations replay in order; tabs share the outbox, so drains hold a cross-tab lock.
 */
export const reviewSync = createSyncChannel({
  channel: 'review',
  pending: () => pendingReview().length,
  lock: true,
  async run({ request }) {
    do {
      while (pendingReview().length) {
        const op = pendingReview()[0];
        try {
          await request('/api/review', { body: op });
        } catch (error) {
          if (!isConflict(error)) throw error;
          // Stop dependent grades; remote state wins. Keep conflict visible until acknowledged.
          const affected = (p: ReviewOperation) =>
            'entryId' in p && 'entryId' in op && p.entryId === op.entryId;
          for (const discarded of pendingReview().filter(affected))
            if (discarded.action === 'grade') forgetReview(discarded.operationId);
          writeStorage(
            'review:pending',
            pendingReview()
              .slice(1)
              .filter((p) => !affected(p)),
          );
          writeStorage(
            'review:conflict',
            'A review changed on another device. Its latest schedule was restored.',
          );
          applyRemote(await request<ReviewSnapshot>('/api/review'));
          notify();
          throw Object.assign(error as Error, { conflict: true });
        }
        if (op.action === 'undo') forgetReview(op.targetOperationId);
        const pending = pendingReview();
        if (JSON.stringify(pending[0]) === JSON.stringify(op))
          writeStorage('review:pending', pending.slice(1));
      }
      applyRemote(await request<ReviewSnapshot>('/api/review'));
      notify();
      // An edit can arrive while the final snapshot is in flight. Drain it under the same lock.
    } while (pendingReview().length);
  },
});
export const refreshReview = (options?: { force?: boolean }) => reviewSync.sync(options);
