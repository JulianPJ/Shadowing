import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newReview } from '../src/lib/review-scheduler';
import {
  limitStudyQueue,
  loadStudyLimits,
  saveStudyLimits,
} from '../src/lib/review/study-settings';
import type { ReviewEvent } from '../src/lib/review/history';
import { installMemoryStorage } from './helpers/memory-storage';
import { readStorage, writeStorage } from '../src/lib/storage/browser';
const at = '2026-10-07T12:00:00.000Z';

test('unlimited queue includes more than 20 due cards and still excludes future/suspended cards', () => {
  const cards = Array.from({ length: 45 }, (_, i) => newReview(`word-${i}`, at));
  cards.push({ ...newReview('tomorrow', at), dueAt: '2026-10-08T12:00:00.000Z' });
  cards.push({ ...newReview('paused', at), status: 'suspended' });
  const copy = structuredClone(cards);
  assert.equal(limitStudyQueue(cards, [], at, { new: null, review: null }).cards.length, 45);
  assert.deepEqual(cards, copy);
});

test('allowances count unique graded cards today, including deleted words; learning retries stay available', () => {
  const cards = Array.from({ length: 6 }, (_, i) => newReview(`word-${i}`, at));
  cards[0] = { ...cards[0], status: 'review', dueAt: '2026-10-11T12:00:00.000Z' };
  cards[1] = { ...cards[1], status: 'learning' };
  const history: ReviewEvent[] = [
    { operationId: 'first', entryId: 'word-0', grade: 'easy', reviewedAt: at, status: 'new' },
    {
      operationId: 'duplicate-card',
      entryId: 'word-0',
      grade: 'good',
      reviewedAt: at,
      status: 'new',
    },
    {
      operationId: 'learning',
      entryId: 'word-1',
      grade: 'again',
      reviewedAt: at,
      status: 'learning',
    },
    {
      operationId: 'yesterday',
      entryId: 'word-2',
      grade: 'good',
      reviewedAt: '2026-10-06T12:00:00.000Z',
      status: 'new',
    },
  ];
  const result = limitStudyQueue(cards, history, at, { new: 2, review: 0 });
  assert.deepEqual(result.reviewed, { new: 1, review: 0 });
  assert.deepEqual(
    result.cards.map((card) => card.entryId),
    ['word-1', 'word-2'],
  );
  // A deleted word's rating still used today's allowance.
  const deleted: ReviewEvent = {
    operationId: 'deleted-grade',
    entryId: 'deleted',
    grade: 'easy',
    reviewedAt: at,
    status: 'new',
  };
  const exhausted = limitStudyQueue(cards, [...history, deleted], at, { new: 2, review: 0 });
  assert.deepEqual(exhausted.reviewed, { new: 2, review: 0 });
  assert.deepEqual(
    exhausted.cards.map((card) => card.entryId),
    ['word-1'],
  );
});

test('one daily limit is stored in synced preferences and ignores legacy deck overrides', () => {
  installMemoryStorage();
  assert.deepEqual(loadStudyLimits(), { new: null, review: null });
  // Device-only settings from before limits synced are still read once.
  writeStorage('review:study-settings', {
    defaults: { new: 7, review: null },
    decks: { travel: { new: 1, review: 1 } },
    extensions: { travel: '2026-10-07' },
  });
  assert.deepEqual(loadStudyLimits(), { new: 7, review: null });
  saveStudyLimits({ new: 15, review: 200 });
  assert.deepEqual(readStorage<{ reviewLimits?: unknown }>('preferences', {}).reviewLimits, {
    defaults: { new: 15, review: 200 },
    decks: {},
  });
  assert.deepEqual(loadStudyLimits(), { new: 15, review: 200 });
});
