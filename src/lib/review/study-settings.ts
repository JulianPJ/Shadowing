import { readStorage, writeStorage } from '../storage/browser';
import { studyDay } from '../study-day';
import type { ReviewState } from './types';
import type { ReviewEvent } from './history';
import { dueReviews } from '../review-scheduler';
import { loadPreferences } from '../storage/preferences';
import { normalizeReviewLimits, type StudyLimits } from './limits';
export type { StudyLimits } from './limits';

/** One daily allowance for new and review cards; synced through account preferences. */
export function loadStudyLimits(): StudyLimits {
  return (
    loadPreferences().reviewLimits ??
    normalizeReviewLimits(readStorage('review:study-settings', null))
  ).defaults;
}
export function saveStudyLimits(limits: StudyLimits) {
  const reviewLimits = normalizeReviewLimits({ defaults: limits, decks: {} });
  const preferences = loadPreferences();
  if (JSON.stringify(preferences.reviewLimits) !== JSON.stringify(reviewLimits))
    writeStorage('preferences', { ...preferences, reviewLimits });
}

/** Ratings count unique cards; intraday learning retries never consume the daily allowance. */
export function limitStudyQueue(
  cards: ReviewState[],
  history: ReviewEvent[],
  at: string,
  limits: StudyLimits,
) {
  const today = studyDay(at);
  const reviewed = { new: new Set<string>(), review: new Set<string>() };
  for (const event of history)
    if (studyDay(event.reviewedAt) === today) {
      const status = event.status ?? 'review';
      if (status === 'new' || status === 'review') reviewed[status].add(event.entryId);
    }
  const remaining = {
    new: limits.new === null ? Infinity : Math.max(0, limits.new - reviewed.new.size),
    review: limits.review === null ? Infinity : Math.max(0, limits.review - reviewed.review.size),
  };
  const admitted = { new: 0, review: 0 };
  return {
    cards: dueReviews(cards, at).filter(
      (card) =>
        card.status === 'learning' ||
        ((card.status === 'new' || card.status === 'review') &&
          admitted[card.status]++ < remaining[card.status]),
    ),
    reviewed: { new: reviewed.new.size, review: reviewed.review.size },
  };
}
