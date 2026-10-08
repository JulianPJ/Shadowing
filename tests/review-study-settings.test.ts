import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newReview } from '../src/lib/review-scheduler';
import { limitStudyQueue, studyLimits, type StudySettings } from '../src/lib/review/study-settings';
import type { ReviewEvent } from '../src/lib/review/history';
const at = '2026-10-07T12:00:00.000Z';
const settings: StudySettings = {
  defaults: { new: 20, review: 100 },
  decks: { travel: { new: 5, review: 50 } },
  extensions: {},
};
test('daily defaults, per-deck overrides and today-only extension never alter schedules', () => {
  assert.deepEqual(studyLimits(settings, 'all', '2026-10-07'), { new: 20, review: 100 });
  assert.deepEqual(studyLimits(settings, 'travel', '2026-10-07'), { new: 5, review: 50 });
  const extended = { ...settings, extensions: { travel: '2026-10-07' } };
  assert.deepEqual(studyLimits(extended, 'travel', '2026-10-07'), { new: null, review: null });
  assert.deepEqual(studyLimits(extended, 'travel', '2026-10-08'), { new: 5, review: 50 });
  assert.deepEqual(
    studyLimits({ ...settings, extensions: { all: '2026-10-07' } }, 'travel', '2026-10-07'),
    { new: null, review: null },
  );
});
test('unlimited queue includes more than 20 due cards and still excludes future/suspended cards', () => {
  const cards = Array.from({ length: 45 }, (_, i) => newReview(`word-${i}`, at));
  cards.push({ ...newReview('tomorrow', at), dueAt: '2026-10-08T12:00:00.000Z' });
  cards.push({ ...newReview('paused', at), status: 'suspended' });
  const copy = structuredClone(cards);
  assert.equal(limitStudyQueue(cards, [], at, { new: null, review: null }).cards.length, 45);
  assert.deepEqual(cards, copy);
});
test('allowances count unique graded cards including those no longer due; learning retries stay available', () => {
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
      operationId: 'other-deck',
      entryId: 'unrelated',
      grade: 'good',
      reviewedAt: at,
      status: 'new',
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
});

test('all-decks queue honours deck overrides and counts words in multiple collections once', async () => {
  const { limitDeckStudyQueue } = await import('../src/lib/review/study-settings');
  const cards = Array.from({ length: 5 }, (_, i) => newReview(`word-${i}`, at));
  const memberships = cards.flatMap((card) => [
    { entryId: card.entryId, deckId: 'travel' },
    { entryId: card.entryId, deckId: 'inbox' },
  ]);
  const constrained = { ...settings, decks: { travel: { new: 2, review: 50 } } };
  const result = limitDeckStudyQueue(cards, memberships, [], at, constrained, 'all');
  assert.equal(result.cards.length, 2);
  assert.equal(new Set(result.cards.map((card) => card.entryId)).size, 2);
  assert.equal(
    limitDeckStudyQueue(
      cards,
      memberships,
      [],
      at,
      { ...constrained, extensions: { all: '2026-10-07' } },
      'all',
    ).cards.length,
    5,
  );
});

test('deleting a previously rated word does not reset the global daily allowance', async () => {
  const { limitDeckStudyQueue } = await import('../src/lib/review/study-settings');
  const cards = [newReview('remaining', at)];
  const history: ReviewEvent[] = [
    {
      operationId: 'deleted-grade',
      entryId: 'deleted',
      grade: 'easy',
      reviewedAt: at,
      status: 'new',
    },
  ];
  const limited = limitDeckStudyQueue(
    cards,
    [],
    history,
    at,
    { ...settings, defaults: { new: 1, review: null } },
    'all',
  );
  assert.equal(limited.cards.length, 0);
  assert.deepEqual(limited.reviewed, { new: 1, review: 0 });
});
