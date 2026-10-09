import { newReview, scheduleReview } from '../review-scheduler';
import type { ReviewOperation, ReviewSnapshot } from './types';
export function emptyReview(): ReviewSnapshot {
  return { cards: [] };
}
/** The same typed operation drives immediate local UI and the durable account outbox. */
export function applyLocalReview(data: ReviewSnapshot, op: ReviewOperation): ReviewSnapshot {
  const next: ReviewSnapshot = { ...data, cards: structuredClone(data.cards) };
  if (op.action === 'enroll') {
    for (const id of op.entryIds) {
      const card = next.cards.find((c) => c.entryId === id);
      if (!card) next.cards.push(newReview(id, op.enrolledAt));
      else if (card.status === 'suspended')
        Object.assign(card, {
          status: 'new',
          dueAt: op.enrolledAt,
          updatedAt: op.enrolledAt,
          revision: card.revision + 1,
        });
    }
  } else {
    next.cards = next.cards.map((c) =>
      c.entryId !== op.entryId || c.revision !== op.revision
        ? c
        : op.action === 'grade'
          ? scheduleReview(c, op.grade, op.reviewedAt)
          : op.action === 'undo'
            ? { ...op.previous, revision: c.revision + 1, updatedAt: op.undoneAt }
            : { ...c, status: 'suspended', revision: c.revision + 1 },
    );
  }
  return next;
}
