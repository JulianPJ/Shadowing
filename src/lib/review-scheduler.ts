import type { ReviewGrade, ReviewState } from './review/types';
const DAY = 86_400_000;
export const REVIEW_ALGORITHM = 'sm2-v1' as const;

export function newReview(entryId: string, now: string): ReviewState {
  if (!Number.isFinite(Date.parse(now))) throw new Error('Invalid review date');
  return {
    entryId,
    schemaVersion: 1,
    algorithm: REVIEW_ALGORITHM,
    status: 'new',
    dueAt: now,
    lastReviewedAt: null,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** SM-2-style grades; elapsed time and timezone never change the chosen interval.
 * Again relearns after 10 minutes; Hard advances conservatively; Good/Easy graduate.
 * No random jitter, overdue bonus, inference, or wall-clock access. */
export function scheduleReview(card: ReviewState, grade: ReviewGrade, now: string): ReviewState {
  const time = Date.parse(now);
  if (
    !Number.isFinite(time) ||
    time < Date.parse(card.updatedAt) ||
    card.status === 'suspended' ||
    card.algorithm !== REVIEW_ALGORITHM ||
    !['again', 'hard', 'good', 'easy'].includes(grade)
  )
    throw new Error('Invalid review');
  let intervalDays: number;
  let ease = card.ease;
  let lapses = card.lapses;
  let repetitions = card.repetitions;
  let status: ReviewState['status'] = 'review';
  if (grade === 'again') {
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    lapses += card.status === 'review' ? 1 : 0;
    repetitions = 0;
    status = 'learning';
  } else if (grade === 'hard') {
    intervalDays = Math.max(1, Math.ceil(card.intervalDays * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    repetitions++;
  } else {
    intervalDays =
      card.intervalDays === 0
        ? grade === 'easy'
          ? 4
          : 1
        : card.repetitions <= 1
          ? grade === 'easy'
            ? 8
            : 6
          : Math.max(
              card.intervalDays + 1,
              Math.round(card.intervalDays * ease * (grade === 'easy' ? 1.3 : 1)),
            );
    if (grade === 'easy') ease += 0.15;
    repetitions++;
  }
  intervalDays = Math.min(36500, intervalDays);
  return {
    ...card,
    intervalDays,
    ease: Math.round(ease * 100) / 100,
    repetitions,
    lapses,
    status,
    dueAt: new Date(time + (grade === 'again' ? 600000 : intervalDays * DAY)).toISOString(),
    lastReviewedAt: now,
    updatedAt: now,
    revision: card.revision + 1,
  };
}

export function dueReviews(cards: ReviewState[], now: string) {
  return cards
    .filter((c) => c.status !== 'suspended' && Date.parse(c.dueAt) <= Date.parse(now))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.entryId.localeCompare(b.entryId));
}
