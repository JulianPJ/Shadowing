'use client';
// One vocabulary model: every saved word has a review card and a status.
//   Add to review → saved entry + review card + Learning
//   Known         → card retired (suspended) + Known
//   Learn again   → card re-enrolled + Learning
// Review keeps status in step: a mature card counts as Known; a lapse returns it to Learning.
import type { DictionaryEntry, DictionarySaveInput } from './dictionary/types';
import type { ReviewState } from './review/types';
import type { WordState } from './knowledge/types';
import { saveDictionary } from './dictionary/client';
import { cachedReview, changeReview } from './review/client';
import { loadKnowledge, markWords } from './knowledge/client';
import { normalizeLemma } from './knowledge/validation';

/** Interval at which a reviewed word counts as Known for highlighting and coverage. */
export const KNOWN_INTERVAL_DAYS = 21;

type Word = Pick<DictionaryEntry, 'id' | 'term' | 'reading'>;

function setStatus(word: Pick<Word, 'term' | 'reading'>, state: WordState) {
  try {
    if (loadKnowledge()[normalizeLemma(word.term)]?.state !== state)
      markWords([{ lemma: word.term, reading: word.reading }], state);
  } catch {
    // Non-Japanese saved terms have no lexical status; the review card still works.
  }
}

export function activeCard(entryId: string, cards = cachedReview().cards) {
  return cards.find((card) => card.entryId === entryId && card.status !== 'suspended');
}

export async function saveWordForReview(input: DictionarySaveInput) {
  const entry = await saveDictionary(input);
  learnWord(entry);
  return entry;
}

export function learnWord(word: Word) {
  changeReview({ action: 'enroll', entryIds: [word.id], enrolledAt: new Date().toISOString() });
  setStatus(word, 'learning');
}

export function markWordKnown(word: Word) {
  const card = activeCard(word.id);
  if (card)
    changeReview({
      action: 'suspend',
      entryId: word.id,
      revision: card.revision,
      operationId: crypto.randomUUID(),
    });
  setStatus(word, 'known');
}

/** The status a grade implies, or null to leave the learner's explicit status alone. */
export function statusAfterGrade(
  before: ReviewState,
  after: ReviewState,
  current: WordState | undefined,
): WordState | null {
  if (current === 'ignored') return null;
  if (after.status === 'review' && after.intervalDays >= KNOWN_INTERVAL_DAYS)
    return current === 'known' ? null : 'known';
  if (before.status === 'review' && after.status === 'learning' && current === 'known')
    return 'learning';
  return null;
}

export function syncStatusAfterGrade(word: Word, before: ReviewState, after: ReviewState) {
  const current = loadKnowledge()[normalizeLemma(word.term)]?.state;
  const next = statusAfterGrade(before, after, current);
  if (next) setStatus(word, next);
}
