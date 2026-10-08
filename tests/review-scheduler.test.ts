import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  dueReviews,
  newReview,
  previewReview,
  reviewIntervalLabel,
  scheduleReview,
} from '../src/lib/review-scheduler';
const start = '2026-10-06T23:59:30.000Z';
const minute = 60_000;
const day = 86_400_000;

function graduate() {
  const learning = scheduleReview(newReview('entry', start), 'good', start);
  return scheduleReview(learning, 'good', learning.dueAt);
}

test('new review is due immediately and carries algorithm/schema identity', () => {
  const card = newReview('entry', start);
  assert.equal(card.status, 'new');
  assert.equal(card.algorithm, 'sm2-v1');
  assert.equal(card.schemaVersion, 1);
  assert.equal(card.revision, 0);
  assert.equal(card.lastReviewedAt, null);
  assert.equal(dueReviews([card], start).length, 1);
});

for (const [grade, intervalMs, label, status, step] of [
  ['again', minute, '1m', 'learning', 0],
  ['hard', 6 * minute, '6m', 'learning', 0],
  ['good', 10 * minute, '10m', 'learning', 1],
  ['easy', 4 * day, '4d', 'review', 1],
] as const) {
  test(`${grade} previews and schedules a new card without mutating its input`, () => {
    const card = newReview('entry', start);
    const copy = structuredClone(card);
    const preview = previewReview(card, grade, start);
    const result = scheduleReview(card, grade, start);
    assert.deepEqual(card, copy);
    assert.deepEqual(preview.state, result);
    assert.equal(preview.intervalMs, intervalMs);
    assert.equal(preview.intervalLabel, label);
    assert.equal(result.intervalDays, status === 'learning' ? 0 : 4);
    assert.equal(result.repetitions, step);
    assert.equal(result.revision, 1);
    assert.equal(result.lastReviewedAt, start);
    assert.equal(Date.parse(result.dueAt) - Date.parse(start), intervalMs);
    assert.equal(result.status, status);
  });
}

test('Again and Hard repeat the first step, Good advances it, then Good graduates', () => {
  let card = scheduleReview(newReview('entry', start), 'again', start);
  for (const [grade, minutes, step] of [
    ['hard', 6, 0],
    ['good', 10, 1],
    ['hard', 10, 1],
    ['again', 1, 0],
    ['good', 10, 1],
  ] as const) {
    const at = card.dueAt;
    card = scheduleReview(card, grade, at);
    assert.equal(card.status, 'learning');
    assert.equal(card.repetitions, step);
    assert.equal(card.intervalDays, 0);
    assert.equal(Date.parse(card.dueAt) - Date.parse(at), minutes * minute);
  }
  card = scheduleReview(card, 'good', card.dueAt);
  assert.equal(card.intervalDays, 1);
  assert.equal(card.status, 'review');
  assert.equal(card.repetitions, 1);
  assert.equal(card.lapses, 0);
});

test('learning Easy graduates immediately and previews match every step', () => {
  for (const card of [
    scheduleReview(newReview('entry', start), 'again', start),
    scheduleReview(newReview('entry', start), 'good', start),
    scheduleReview({ ...graduate(), intervalDays: 20 }, 'again', graduate().dueAt),
  ]) {
    for (const grade of ['again', 'hard', 'good', 'easy'] as const) {
      const preview = previewReview(card, grade, card.dueAt);
      assert.deepEqual(preview.state, scheduleReview(card, grade, card.dueAt));
      assert.equal(Date.parse(preview.state.dueAt) - Date.parse(card.dueAt), preview.intervalMs);
    }
    const easy = scheduleReview(card, 'easy', card.dueAt);
    assert.equal(easy.status, 'review');
    assert.ok(easy.intervalDays >= 4);
  }
});

test('graduated Good reviews retain the existing 1,6,ease-scaled intervals', () => {
  let card = graduate();
  assert.equal(card.intervalDays, 1);
  for (const days of [6, 15, 38, 95]) {
    card = scheduleReview(card, 'good', card.dueAt);
    assert.equal(card.intervalDays, days);
  }
  assert.equal(card.repetitions, 5);
  assert.equal(card.lapses, 0);
});

test('Hard reduces review ease conservatively; Easy advances interval and ease', () => {
  const base = {
    ...newReview('entry', start),
    status: 'review' as const,
    intervalDays: 10,
    repetitions: 3,
  };
  const hard = scheduleReview(base, 'hard', start);
  const easy = scheduleReview(base, 'easy', start);
  assert.equal(hard.intervalDays, 12);
  assert.equal(hard.ease, 2.35);
  assert.equal(easy.intervalDays, 33);
  assert.equal(easy.ease, 2.65);
});

test('review Again retains a relearning interval and counts one lapse until graduation', () => {
  let card = { ...graduate(), intervalDays: 20, repetitions: 5 };
  card = scheduleReview(card, 'again', card.dueAt);
  assert.equal(card.lapses, 1);
  assert.equal(card.repetitions, 0);
  assert.equal(card.intervalDays, 10);
  assert.equal(card.status, 'learning');
  assert.equal(Date.parse(card.dueAt) - Date.parse(card.updatedAt), minute);
  card = scheduleReview(card, 'again', card.dueAt);
  assert.equal(card.lapses, 1);
  assert.equal(card.intervalDays, 10);
  card = scheduleReview(card, 'good', card.dueAt);
  assert.equal(card.status, 'learning');
  assert.equal(card.repetitions, 1);
  card = scheduleReview(card, 'good', card.dueAt);
  assert.equal(card.intervalDays, 10);
  assert.equal(card.status, 'review');
  assert.equal(card.repetitions, 2);
  card = scheduleReview(card, 'good', card.dueAt);
  assert.ok(card.intervalDays > 10);
});

test('legacy schema-v1 learning cards enter steps without losing history or identity', () => {
  const legacy = {
    ...newReview('entry', start),
    status: 'learning' as const,
    dueAt: '2026-10-07T00:09:30.000Z',
    lastReviewedAt: start,
    repetitions: 0,
    lapses: 3,
    ease: 1.8,
    revision: 20,
  };
  const advanced = scheduleReview(legacy, 'good', legacy.dueAt);
  assert.equal(advanced.status, 'learning');
  assert.equal(advanced.repetitions, 1);
  assert.equal(advanced.lapses, 3);
  assert.equal(advanced.ease, 1.8);
  assert.equal(advanced.algorithm, 'sm2-v1');
  assert.equal(advanced.schemaVersion, 1);
  assert.equal(advanced.revision, 21);
  assert.equal(advanced.createdAt, legacy.createdAt);
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
  ]) {
    const card = { ...newReview('e', at), status: 'learning' as const, repetitions: 1 };
    assert.equal(scheduleReview(card, 'good', at).dueAt, due);
  }
});

test('ease has a floor, intervals have a bound, and scheduler is exactly deterministic', () => {
  let card = graduate();
  for (let i = 0; i < 100; i++) card = scheduleReview(card, 'hard', card.dueAt);
  assert.equal(card.ease, 1.3);
  assert.ok(card.intervalDays <= 36500);
  assert.deepEqual(
    scheduleReview(card, 'easy', card.dueAt),
    scheduleReview(structuredClone(card), 'easy', card.dueAt),
  );
  assert.equal(previewReview(card, 'easy', card.dueAt).intervalMs, 36500 * day);
});

test('interval labels use the scheduler delay and reject invalid values', () => {
  assert.equal(reviewIntervalLabel(30_000), '30s');
  assert.equal(reviewIntervalLabel(90 * minute), '90m');
  assert.equal(reviewIntervalLabel(2 * 60 * minute), '2h');
  assert.equal(reviewIntervalLabel(6 * day), '6d');
  assert.throws(() => reviewIntervalLabel(-1));
  assert.throws(() => reviewIntervalLabel(Number.NaN));
});

test('due ordering is stable and excludes future/suspended cards until learning is ready', () => {
  const a = newReview('a', start);
  const b = newReview('b', start);
  const learning = scheduleReview(newReview('learning', start), 'again', start);
  const cards = [
    b,
    a,
    learning,
    { ...a, entryId: 'future', dueAt: '2027-01-01T00:00:00.000Z' },
    { ...a, entryId: 'paused', status: 'suspended' as const },
  ];
  assert.deepEqual(
    dueReviews(cards, start).map((c) => c.entryId),
    ['a', 'b'],
  );
  assert.deepEqual(
    dueReviews(cards, learning.dueAt).map((c) => c.entryId),
    ['a', 'b', 'learning'],
  );
});

test('invalid dates, backwards dates, suspended cards and algorithms cannot grade', () => {
  const card = newReview('entry', start);
  assert.throws(() => newReview('entry', 'bad'));
  assert.throws(() => scheduleReview(card, 'good', 'bad'));
  assert.throws(() => scheduleReview(card, 'good', '2020-01-01T00:00:00.000Z'));
  assert.throws(() => scheduleReview({ ...card, status: 'suspended' }, 'good', start));
  assert.throws(() => scheduleReview({ ...card, algorithm: 'unknown' as 'sm2-v1' }, 'good', start));
});
