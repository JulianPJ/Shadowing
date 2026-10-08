import { readStorage, writeStorage } from '../storage/browser';
import { studyDay } from '../study-day';
import type { ReviewState } from './types';
import type { ReviewEvent } from './history';
import { dueReviews } from '../review-scheduler';
import { loadPreferences } from '../storage/preferences';
import { normalizeReviewLimits, type StudyLimits } from './limits';
export type { StudyLimits } from './limits';
export type StudySettings = {
  defaults: StudyLimits;
  decks: Record<string, StudyLimits>;
  extensions: Record<string, string>;
};
const unlimited: StudyLimits = { new: null, review: null };
function extensions(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([id, day]) =>
          /^[\w-]{1,100}$/.test(id) &&
          !['__proto__', 'prototype', 'constructor'].includes(id) &&
          typeof day === 'string' &&
          /^\d{4}-\d\d-\d\d$/.test(day),
      )
      .slice(0, 101),
  ) as Record<string, string>;
}
export function loadStudySettings(): StudySettings {
  const raw = readStorage<Partial<StudySettings> | null>('review:study-settings', null);
  const reviewLimits = loadPreferences().reviewLimits ?? normalizeReviewLimits(raw);
  return {
    ...reviewLimits,
    extensions: extensions(raw?.extensions),
  };
}
export function saveStudySettings(settings: StudySettings) {
  const reviewLimits = normalizeReviewLimits(settings);
  writeStorage('review:study-settings', {
    ...reviewLimits,
    extensions: extensions(settings.extensions),
  });
  const preferences = loadPreferences();
  if (JSON.stringify(preferences.reviewLimits) !== JSON.stringify(reviewLimits))
    writeStorage('preferences', { ...preferences, reviewLimits });
}
export function studyLimits(settings: StudySettings, deck: string, today: string): StudyLimits {
  return settings.extensions[deck] === today || settings.extensions.all === today
    ? unlimited
    : (settings.decks[deck] ?? settings.defaults);
}
/** Ratings count unique cards; intraday learning retries never consume the daily allowance. */
export function limitStudyQueue(
  cards: ReviewState[],
  history: ReviewEvent[],
  at: string,
  chosen: StudyLimits,
  countAllHistory = false,
) {
  const today = studyDay(at);
  const ids = new Set(cards.map((card) => card.entryId));
  const reviewed = { new: new Set<string>(), review: new Set<string>() };
  for (const event of history)
    if ((countAllHistory || ids.has(event.entryId)) && studyDay(event.reviewedAt) === today) {
      const status = event.status ?? 'review';
      if (status === 'new' || status === 'review') reviewed[status].add(event.entryId);
    }
  const remaining = {
    new: chosen.new === null ? Infinity : Math.max(0, chosen.new - reviewed.new.size),
    review: chosen.review === null ? Infinity : Math.max(0, chosen.review - reviewed.review.size),
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

/** The combined queue honours explicit deck overrides without copying a word's schedule. */
export function limitDeckStudyQueue(
  cards: ReviewState[],
  memberships: { entryId: string; deckId: string }[],
  history: ReviewEvent[],
  at: string,
  settings: StudySettings,
  deck: string,
) {
  const base = limitStudyQueue(
    cards,
    history,
    at,
    studyLimits(settings, deck, studyDay(at)),
    deck === 'all',
  );
  if (deck !== 'all') return base;
  const remaining = (limits: StudyLimits, reviewed: { new: number; review: number }) => ({
    new: limits.new === null ? Infinity : Math.max(0, limits.new - reviewed.new),
    review: limits.review === null ? Infinity : Math.max(0, limits.review - reviewed.review),
  });
  const globalRemaining = remaining(studyLimits(settings, deck, studyDay(at)), base.reviewed);
  const allowances = Object.keys(settings.decks).map((deckId) => {
    const membership = new Set(
      memberships.filter((item) => item.deckId === deckId).map((item) => item.entryId),
    );
    const scoped = cards.filter((card) => membership.has(card.entryId));
    const limits = studyLimits(settings, deckId, studyDay(at));
    const { reviewed } = limitStudyQueue(scoped, history, at, limits);
    return { membership, remaining: remaining(limits, reviewed) };
  });
  return {
    ...base,
    cards: dueReviews(cards, at).filter((card) => {
      if (card.status === 'learning') return true;
      if (card.status !== 'new' && card.status !== 'review') return false;
      const kind = card.status;
      const decks = allowances.filter(({ membership }) => membership.has(card.entryId));
      if (globalRemaining[kind] <= 0 || decks.some((scope) => scope.remaining[kind] <= 0))
        return false;
      // A skipped deck must not consume capacity in another deck or the global
      // queue. Admit once, then charge every applicable allowance together.
      globalRemaining[kind]--;
      for (const scope of decks) scope.remaining[kind]--;
      return true;
    }),
  };
}
