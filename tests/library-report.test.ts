import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentFit,
  emptyLibrary,
  enqueue,
  normalizeQueueUrl,
  validateLibrary,
} from '../src/lib/library/model';
import { validateGoal, weeklyReport } from '../src/lib/reports/weekly';
import {
  createSession,
  emptyHistory,
  lessonIdentity,
  sectionActivity,
} from '../src/lib/learner-progress';
import demo from '../src/data/demo.json';
import type { Lesson } from '../src/lib/types';
import { installMemoryStorage } from './helpers/memory-storage';
import { setStorageAccount, writeStorage } from '../src/lib/storage/browser';
import { rememberReview, reviewHistory } from '../src/lib/review/history';

test('queue keeps credential-free navigation, canonical duplicates, order and storage bounds', () => {
  const a = {
    id: 'a',
    url: 'https://youtu.be/abcdefghijk?si=tracking',
    title: 'A',
    addedAt: '2026-10-06T00:00:00.000Z',
  };
  const state = enqueue(emptyLibrary(), a);
  assert.equal(state.queue[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.throws(
    () =>
      enqueue(state, { ...a, id: 'b', url: 'https://www.youtube.com/watch?v=abcdefghijk&list=x' }),
    /already/,
  );
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,x',
    'https://secret:password@example.com/a.mp4',
    '/relative',
  ])
    assert.throws(() => normalizeQueueUrl(url));
  assert.equal(
    validateLibrary({
      version: 1,
      pinned: Array.from({ length: 80 }, (_, i) => `lesson-${i}`),
      queue: [{ ...a, url: 'javascript:alert(1)' }, a],
    }).pinned.length,
    60,
  );
  assert.equal(
    validateLibrary({ version: 1, pinned: [], queue: [{ ...a, url: 'javascript:alert(1)' }, a] })
      .queue.length,
    1,
  );
  assert.deepEqual(validateLibrary({ version: 2 }), emptyLibrary());
});

test('personal fit abstains for cold start and uses explicit vocabulary with content context', () => {
  assert.equal(contentFit(null).label, 'Not enough evidence');
  assert.equal(
    contentFit({ knownPercent: 100, trackedLemmas: 4, uniqueLemmas: 50 }).label,
    'Not enough evidence',
  );
  assert.equal(
    contentFit({ knownPercent: 100, trackedLemmas: 12, uniqueLemmas: 9 }).label,
    'Not enough evidence',
  );
  const fit = (knownPercent: number) =>
    contentFit({ knownPercent, trackedLemmas: 30, uniqueLemmas: 40 }, 'N4–N3');
  assert.equal(fit(90).label, 'Comfortable');
  assert.equal(fit(89).label, 'Stretch');
  assert.equal(fit(75).label, 'Stretch');
  assert.equal(fit(74).label, 'Hard');
  assert.match(fit(90).reason, /not a comprehension score/);
  assert.equal(
    contentFit({ knownPercent: 95, trackedLemmas: 30, uniqueLemmas: 40 }, 'N2–N1', true).label,
    'Stretch',
  );
});

test('weekly report includes retained UTC time and genuine new evidence without assigning archive actions to a week', () => {
  const history = emptyHistory();
  const lesson = lessonIdentity(demo as Lesson, 'transcript-key');
  const session = createSession(lesson, '2026-10-05T22:00:00.000Z');
  session.updatedAt = '2026-10-06T00:20:00.000Z';
  session.activeSeconds = 190;
  session.activeByDay = { '2026-09-29': 60, '2026-10-05': 100, '2026-10-06': 30 };
  session.sections = [{ ...sectionActivity(demo.segments[0]), replays: 2, recordingAttempts: 1 }];
  history.sessions.push(session);
  const archived = {
    ...session,
    id: 'archive-session',
    activeSeconds: 200,
    activeByDay: { '2026-10-04': 200 },
  };
  history.archives.push({ schemaVersion: 1, lesson, sessionCount: 5, activity: archived });
  const report = weeklyReport(
    {
      history,
      saved: [{ createdAt: '2026-10-04T12:00:00.000Z' }, { createdAt: '2026-09-29T12:00:00.000Z' }],
      knowledge: [
        { state: 'known', updatedAt: '2026-10-02T12:00:00.000Z' },
        { state: 'learning', updatedAt: '2026-10-02T12:00:00.000Z' },
      ],
      reviews: [
        { operationId: '1', entryId: 'a', grade: 'good', reviewedAt: '2026-10-06T01:00:00.000Z' },
        { operationId: '2', entryId: 'b', grade: 'again', reviewedAt: '2026-10-06T01:00:00.000Z' },
      ],
      matches: [
        { attemptedAt: '2026-10-06T01:00:00.000Z', score: 80 },
        { attemptedAt: '2026-10-06T01:10:00.000Z', score: 90 },
        { attemptedAt: '2026-10-07T01:10:00.000Z', score: 100 },
      ],
    },
    '2026-10-06T12:00:00.000Z',
  );
  assert.equal(report.from, '2026-09-30');
  assert.equal(report.activeSeconds, 330);
  assert.equal(report.todaySeconds, 30);
  assert.equal(report.sectionsPractised, 1);
  assert.equal(report.recordingAttempts, 1);
  assert.equal(report.markedKnown, 1);
  assert.equal(report.savedTerms, 1);
  assert.equal(report.reviewRecall, 50);
  assert.equal(report.averageMatch, 85);
  assert.equal(report.shadowingAttempts, 2);
});

test('goals are optional and reports preserve absence of review and match evidence', () => {
  assert.deepEqual(validateGoal({ version: 1, minutes: 5 }), { version: 1, minutes: 5 });
  for (const minutes of [0, 121, -1, 2.5, '5'])
    assert.equal(validateGoal({ version: 1, minutes }).minutes, null);
  const report = weeklyReport(
    { history: emptyHistory(), reviews: [], saved: [], knowledge: [], matches: [] },
    '2026-10-06T01:00:00.000Z',
  );
  assert.equal(report.reviewRecall, null);
  assert.equal(report.averageMatch, null);
  assert.equal(report.activeSeconds, 0);
  assert.throws(() =>
    weeklyReport(
      { history: emptyHistory(), reviews: [], saved: [], knowledge: [], matches: [] },
      'invalid',
    ),
  );
});

test('local self-rated recall events are idempotent, bounded and account scoped', () => {
  installMemoryStorage();
  setStorageAccount('report-owner-a');
  const event = {
    operationId: 'answer-one',
    entryId: 'word-one',
    grade: 'good' as const,
    reviewedAt: '2026-10-06T00:00:00.000Z',
  };
  rememberReview(event);
  rememberReview(event);
  assert.equal(reviewHistory().length, 1);
  writeStorage('review:history', [
    ...Array.from({ length: 2100 }, (_, i) => ({ ...event, operationId: `event-${i}` })),
    { ...event, grade: 'invented' },
  ]);
  assert.equal(reviewHistory().length, 2000);
  setStorageAccount('report-owner-b');
  assert.equal(reviewHistory().length, 0);
  setStorageAccount('report-owner-a');
  assert.equal(reviewHistory().length, 2000);
  setStorageAccount(null);
});
