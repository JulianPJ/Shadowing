import type { ReviewGrade, ReviewState } from './review/types';
const DAY = 86_400_000;
const MINUTE = 60_000;
const FIRST_STEP = MINUTE;
const HARD_STEP = 6 * MINUTE;
const SECOND_STEP = 10 * MINUTE;
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

/** SM-2-style review intervals with explicit 1m/10m learning steps.
 * Existing schema-v1 rows need no migration: while status is learning, repetitions
 * is the next learning step (0 = first, 1 = final), and intervalDays is 0 for new
 * learning or the retained graduation interval for relearning. Legacy learning
 * rows (intervalDays = repetitions = 0) start at the first step. Other statuses
 * retain the existing meaning of repetitions and intervalDays.
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
  let intervalMs: number;
  if (card.status === 'new' || card.status === 'learning' || grade === 'again') {
    // Keep the previous interval through relearning using fields both local and
    // D1 repositories already persist. Again on an ungraduated card is no lapse.
    const retainedDays =
      card.status === 'review'
        ? Math.max(1, Math.round(card.intervalDays / 2))
        : card.status === 'learning'
          ? card.intervalDays
          : 0;
    if (grade === 'again') {
      ease = Math.max(1.3, ease - 0.2);
      lapses += card.status === 'review' ? 1 : 0;
      repetitions = 0;
      intervalDays = retainedDays;
      intervalMs = FIRST_STEP;
      status = 'learning';
    } else if (grade === 'hard') {
      // Hard repeats the current step; the initial 6m falls between 1m and 10m.
      repetitions = card.status === 'learning' && card.repetitions >= 1 ? 1 : 0;
      intervalDays = retainedDays;
      intervalMs = repetitions === 1 ? SECOND_STEP : HARD_STEP;
      status = 'learning';
    } else if (grade === 'good' && (card.status !== 'learning' || card.repetitions < 1)) {
      repetitions = 1;
      intervalDays = retainedDays;
      intervalMs = SECOND_STEP;
      status = 'learning';
    } else {
      intervalDays = Math.max(retainedDays, grade === 'easy' ? 4 : 1);
      // Relearning resumes mature interval growth rather than resetting to 6d.
      repetitions = retainedDays > 0 ? 2 : 1;
      if (grade === 'easy') ease += 0.15;
      intervalMs = intervalDays * DAY;
    }
  } else if (grade === 'hard') {
    intervalDays = Math.max(1, Math.ceil(card.intervalDays * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    repetitions++;
    intervalMs = intervalDays * DAY;
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
    intervalMs = intervalDays * DAY;
  }
  if (intervalDays > 36500) {
    intervalDays = 36500;
    if (status === 'review') intervalMs = intervalDays * DAY;
  }
  return {
    ...card,
    intervalDays,
    ease: Math.round(ease * 100) / 100,
    repetitions,
    lapses,
    status,
    dueAt: new Date(time + intervalMs).toISOString(),
    lastReviewedAt: now,
    updatedAt: now,
    revision: card.revision + 1,
  };
}

/** Preview and grading deliberately share one transition, including learning steps. */
export function previewReview(card: ReviewState, grade: ReviewGrade, now: string) {
  const state = scheduleReview(card, grade, now);
  const intervalMs = Date.parse(state.dueAt) - Date.parse(now);
  return { state, intervalMs, intervalLabel: reviewIntervalLabel(intervalMs) };
}

export function reviewIntervalLabel(intervalMs: number): string {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) throw new Error('Invalid review interval');
  if (intervalMs > 0 && intervalMs % DAY === 0) return `${intervalMs / DAY}d`;
  if (intervalMs > 0 && intervalMs % (60 * MINUTE) === 0) return `${intervalMs / (60 * MINUTE)}h`;
  if (intervalMs > 0 && intervalMs % MINUTE === 0) return `${intervalMs / MINUTE}m`;
  return `${Math.ceil(intervalMs / 1000)}s`;
}

export function dueReviews(cards: ReviewState[], now: string) {
  return cards
    .filter((c) => c.status !== 'suspended' && Date.parse(c.dueAt) <= Date.parse(now))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.entryId.localeCompare(b.entryId));
}
