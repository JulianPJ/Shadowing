import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueReviews, newReview, scheduleReview } from '../src/lib/review-scheduler';
const start = '2026-10-06T23:59:30.000Z';
test('new review is due immediately and carries algorithm/schema identity', () => {
  const card = newReview('entry', start);
  assert.equal(card.status, 'new');
  assert.equal(card.algorithm, 'sm2-v1');
  assert.equal(card.schemaVersion, 1);
  assert.equal(card.revision, 0);
  assert.equal(card.lastReviewedAt, null);
  assert.equal(dueReviews([card], start).length, 1);
});
for (const [grade, days] of [
  ['again', 0],
  ['hard', 1],
  ['good', 1],
  ['easy', 4],
] as const) {
  test(`${grade} schedules a new card without mutating its input`, () => {
    const card = newReview('entry', start),
      copy = structuredClone(card),
      result = scheduleReview(card, grade, start);
    assert.deepEqual(card, copy);
    assert.equal(result.intervalDays, days);
    assert.equal(result.revision, 1);
    assert.equal(result.lastReviewedAt, start);
    assert.equal(
      Date.parse(result.dueAt) - Date.parse(start),
      grade === 'again' ? 600000 : days * 86400000,
    );
    assert.equal(result.status, grade === 'again' ? 'learning' : 'review');
  });
}
test('repeated Good reviews follow 1,6,ease-scaled intervals', () => {
  let card = newReview('entry', start);
  const expected = [1, 6, 15, 38, 95];
  for (const days of expected) {
    card = scheduleReview(card, 'good', card.dueAt);
    assert.equal(card.intervalDays, days);
  }
  assert.equal(card.repetitions, 5);
  assert.equal(card.lapses, 0);
});
test('Hard reduces ease conservatively; Easy advances interval and ease', () => {
  const base = {
    ...newReview('entry', start),
    status: 'review' as const,
    intervalDays: 10,
    repetitions: 3,
  };
  const hard = scheduleReview(base, 'hard', start),
    easy = scheduleReview(base, 'easy', start);
  assert.equal(hard.intervalDays, 12);
  assert.equal(hard.ease, 2.35);
  assert.equal(easy.intervalDays, 33);
  assert.equal(easy.ease, 2.65);
});
test('Again counts a lapse on a graduated card and relearns without repeated lapse inflation', () => {
  let card = scheduleReview(newReview('entry', start), 'good', start);
  card = scheduleReview(card, 'again', card.dueAt);
  assert.equal(card.lapses, 1);
  assert.equal(card.repetitions, 0);
  card = scheduleReview(card, 'again', card.dueAt);
  assert.equal(card.lapses, 1);
  card = scheduleReview(card, 'good', card.dueAt);
  assert.equal(card.intervalDays, 1);
  assert.equal(card.status, 'review');
});
test('overdue cards schedule from review time without hidden bonuses', () => {
  const base = {
    ...newReview('entry', start),
    intervalDays: 6,
    repetitions: 2,
    status: 'review' as const,
  };
  const late = '2026-11-10T00:00:00.000Z';
  const card = scheduleReview(base, 'good', late);
  assert.equal(card.intervalDays, 15);
  assert.equal(card.dueAt, '2026-11-25T00:00:00.000Z');
});
test('midnight, leap day, DST and year boundaries use exact elapsed days', () => {
  for (const [at, due] of [
    ['2028-02-28T23:59:59.000Z', '2028-02-29T23:59:59.000Z'],
    ['2026-10-24T23:30:00.000Z', '2026-10-25T23:30:00.000Z'],
    ['2026-12-31T23:59:59.000Z', '2027-01-01T23:59:59.000Z'],
  ])
    assert.equal(scheduleReview(newReview('e', at), 'good', at).dueAt, due);
});
test('ease has a floor, intervals have a bound, and scheduler is exactly deterministic', () => {
  let card = newReview('entry', start);
  for (let i = 0; i < 100; i++) card = scheduleReview(card, 'hard', card.dueAt);
  assert.equal(card.ease, 1.3);
  assert.ok(card.intervalDays <= 36500);
  assert.deepEqual(
    scheduleReview(card, 'easy', card.dueAt),
    scheduleReview(structuredClone(card), 'easy', card.dueAt),
  );
});
test('due ordering is stable and excludes future/suspended cards', () => {
  const a = newReview('a', start),
    b = newReview('b', start);
  assert.deepEqual(
    dueReviews(
      [
        b,
        a,
        { ...a, entryId: 'future', dueAt: '2027-01-01T00:00:00.000Z' },
        { ...a, entryId: 'paused', status: 'suspended' },
      ],
      start,
    ).map((c) => c.entryId),
    ['a', 'b'],
  );
});
test('invalid dates, backwards dates, suspended cards and algorithms cannot grade', () => {
  const card = newReview('entry', start);
  assert.throws(() => newReview('entry', 'bad'));
  assert.throws(() => scheduleReview(card, 'good', 'bad'));
  assert.throws(() => scheduleReview(card, 'good', '2020-01-01T00:00:00.000Z'));
  assert.throws(() => scheduleReview({ ...card, status: 'suspended' }, 'good', start));
});
