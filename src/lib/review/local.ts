import { newReview, scheduleReview } from '../review-scheduler';
import type { ReviewOperation, ReviewSnapshot } from './types';
export function emptyReview(): ReviewSnapshot {
  return { decks: [], memberships: [], cards: [] };
}
/** The same typed operation drives immediate local UI and the durable account outbox. */
export function applyLocalReview(data: ReviewSnapshot, op: ReviewOperation): ReviewSnapshot {
  const next = structuredClone(data);
  if (op.action === 'deck') {
    const now = new Date().toISOString();
    const existing = next.decks.find((deck) => deck.id === op.id);
    if (existing) {
      if (existing.id !== 'inbox')
        Object.assign(existing, { name: op.name.trim(), updatedAt: now });
    } else next.decks.push({ id: op.id, name: op.name.trim(), createdAt: now, updatedAt: now });
  } else if (op.action === 'delete-deck') {
    next.decks = next.decks.filter((d) => d.id !== op.deckId);
    next.memberships = next.memberships.filter((m) => m.deckId !== op.deckId);
  } else if (op.action === 'membership' || op.action === 'enroll') {
    for (const id of op.entryIds) {
      if (op.action === 'membership' && op.remove)
        next.memberships = next.memberships.filter(
          (m) => m.deckId !== op.deckId || m.entryId !== id,
        );
      else if (!next.memberships.some((m) => m.deckId === op.deckId && m.entryId === id))
        next.memberships.push({ deckId: op.deckId, entryId: id });
      if (op.action === 'enroll') {
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
    }
  } else if (op.action === 'grade' || op.action === 'suspend' || op.action === 'undo') {
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
