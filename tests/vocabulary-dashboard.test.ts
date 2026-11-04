import assert from 'node:assert/strict';
import { test } from 'node:test';
import { vocabularyDashboard, wordKanji, relatedWords } from '../src/lib/vocabulary-dashboard';
import type { ReviewState } from '../src/lib/review/types';
import type { DictionaryEntry } from '../src/lib/dictionary/types';
const now = '2026-11-03T12:00:00.000Z';
function card(id: string, dueAt = now): ReviewState {
  return {
    entryId: id,
    schemaVersion: 1,
    algorithm: 'sm2-v1',
    status: 'review',
    dueAt,
    lastReviewedAt: null,
    intervalDays: 3,
    ease: 2.5,
    repetitions: 2,
    lapses: 0,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  };
}
test('empty dashboard has no invented history, growth or predictive workload', () => {
  const d = vocabularyDashboard([], [], now, 'Europe/London');
  assert.equal(d.dueToday, 0);
  assert.equal(d.historyStart, null);
  assert.equal(d.todayEvents.length, 0);
  assert.equal(d.difficult.length, 0);
  assert.equal(d.schedule.length, 14);
  assert.ok(d.activity.every((a) => a.answers === 0));
});
test('deduplicates multi-device history, excludes future answers, explains limited evidence and counts current due dates', () => {
  const event = { operationId: 'one', entryId: 'a', grade: 'again' as const, reviewedAt: now };
  const d = vocabularyDashboard(
    [
      card('a'),
      { ...card('b', '2026-11-02T10:00:00.000Z'), lapses: 2 },
      { ...card('s'), status: 'suspended' },
      card('future', '2026-11-04T10:00:00.000Z'),
    ],
    [
      event,
      event,
      { ...event, operationId: 'two', grade: 'hard' },
      { ...event, operationId: 'older', reviewedAt: '2026-10-01T10:00:00.000Z' },
      { ...event, operationId: 'future', reviewedAt: '2027-01-01T10:00:00.000Z' },
    ],
    now,
    'Europe/London',
  );
  assert.equal(d.todayEvents.length, 2);
  assert.equal(d.reviewedWords.length, 1);
  assert.deepEqual(d.grades, { again: 1, hard: 1, good: 0, easy: 0 });
  assert.equal(d.dueToday, 2);
  assert.equal(d.overdue, 1);
  assert.equal(d.schedule[1].cards, 1);
  assert.equal(d.schedule[0].cards, 1);
  assert.match(d.difficult.find((x) => x.entryId === 'a')!.reasons.join(' '), /1 Again.*1 Hard/);
  assert.equal(d.difficult[0].entryId, 'b');
  assert.match(d.historyStart!, /^2026-10-01/);
});
test('whole-word kanji and reading relationships avoid a guessed per-character reading', () => {
  assert.deepEqual(wordKanji('日本語と日本'), ['日', '本', '語']);
  const word = { id: 'a', term: '橋', reading: 'はし' } as DictionaryEntry;
  assert.deepEqual(
    relatedWords(word, [
      word,
      { id: 'b', term: '箸', reading: 'ハシ' },
      { id: 'c', term: '端', reading: null },
    ] as DictionaryEntry[]).map((e) => e.id),
    ['b'],
  );
});
test('large snapshot calculations use bounded single-pass date grouping', () => {
  const events = Array.from({ length: 10000 }, (_, i) => ({
    operationId: String(i),
    entryId: 'a',
    grade: 'good' as const,
    reviewedAt: now,
  }));
  const started = performance.now();
  const d = vocabularyDashboard([card('a')], events, now, 'Europe/London');
  assert.equal(d.grades.good, 10000);
  assert.equal(d.reviewedWords.length, 1);
  assert.ok(performance.now() - started < 3000);
});
