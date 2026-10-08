import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studyDay, shiftStudyDay } from '../src/lib/study-day';
import { weeklyReport } from '../src/lib/reports/weekly';
import { createSession } from '../src/lib/learner/sessions';
import { validateSession } from '../src/lib/learner/validation';
import { mergeActivity } from '../src/lib/learner/retention';
import { lessonIdentity, emptyHistory } from '../src/lib/learner/constants';
import demo from '../src/data/demo.json' with { type: 'json' };
import type { Lesson } from '../src/lib/types';

test('study days follow local midnight across summer time, winter time and DST transitions', () => {
  assert.equal(studyDay('2026-10-07T23:30:00.000Z', 'Europe/London'), '2026-10-08');
  assert.equal(studyDay('2026-12-07T23:30:00.000Z', 'Europe/London'), '2026-12-07');
  assert.equal(studyDay('2026-10-25T00:30:00.000Z', 'Europe/London'), '2026-10-25');
  assert.equal(studyDay('2026-10-25T01:30:00.000Z', 'Europe/London'), '2026-10-25');
  assert.equal(shiftStudyDay('2026-10-25', -6), '2026-10-19');
});
test('weekly local samples and timestamped reviews agree without rewriting historical UTC time', () => {
  const now = '2026-10-07T23:30:00.000Z';
  const session = createSession(lessonIdentity(demo as Lesson, 'a'.repeat(64)), now);
  session.activeSeconds = 90;
  session.activeByDay = { '2026-10-07': 90 };
  session.localActiveByDay = { '2026-10-08': 90 };
  const original = structuredClone(session);
  const history = emptyHistory();
  history.sessions = [validateSession(session)];
  const report = weeklyReport(
    {
      history,
      reviews: [{ operationId: 'answer', entryId: 'word', grade: 'good', reviewedAt: now }],
      saved: [],
      knowledge: [],
      matches: [],
    },
    now,
    'Europe/London',
  );
  assert.equal(report.to, '2026-10-08');
  assert.equal(report.todaySeconds, 90);
  assert.equal(report.reviewAnswers, 1);
  assert.equal(report.activeSeconds, 90);
  assert.equal(report.legacyUtcSeconds, 0);
  assert.deepEqual(session, original);
  const legacy = createSession(session.lesson, now);
  legacy.activeSeconds = 60;
  legacy.activeByDay = { '2026-10-07': 60 };
  mergeActivity(session, legacy);
  assert.equal(session.activeSeconds, 150);
  assert.deepEqual(session.localActiveByDay, { '2026-10-08': 90 });
  history.sessions = [validateSession(session)];
  const mixed = weeklyReport(
    { history, reviews: [], saved: [], knowledge: [], matches: [] },
    now,
    'Europe/London',
  );
  assert.equal(mixed.todaySeconds, 90);
  assert.equal(mixed.legacyUtcSeconds, 60);
  assert.equal(mixed.activeSeconds, 150);
  assert.throws(() => validateSession({ ...session, localActiveByDay: { '2026-10-08': 151 } }));
});

test('compacting mixed archives preserves in-week legacy UTC buckets across older activity', () => {
  const now = '2026-10-07T23:30:00.000Z';
  const identity = lessonIdentity(demo as Lesson, 'a'.repeat(64));
  const legacy = createSession(identity, now);
  legacy.activeSeconds = 3660;
  legacy.activeByDay = { '2026-06-01': 3600, '2026-10-07': 60 };
  const fresh = createSession(identity, now);
  fresh.activeSeconds = 90;
  fresh.activeByDay = { '2026-10-07': 90 };
  fresh.localActiveByDay = { '2026-10-08': 90 };
  fresh.legacyActiveByDay = {};
  const report = (sessions: (typeof legacy)[]) =>
    weeklyReport(
      {
        history: { ...emptyHistory(), sessions },
        reviews: [],
        saved: [],
        knowledge: [],
        matches: [],
      },
      now,
      'Europe/London',
    );
  assert.equal(report([legacy, fresh]).activeSeconds, 150);
  mergeActivity(legacy, fresh);
  const compacted = report([validateSession(legacy)]);
  assert.equal(compacted.activeSeconds, 150);
  assert.equal(compacted.legacyUtcSeconds, 60);
  assert.equal(compacted.todaySeconds, 90);
  const second = createSession(identity, now);
  second.activeSeconds = 10;
  second.activeByDay = { '2026-10-07': 10 };
  mergeActivity(legacy, second);
  assert.equal(report([validateSession(legacy)]).legacyUtcSeconds, 70);
  assert.throws(() => validateSession({ ...legacy, legacyActiveByDay: { '2026-10-07': 10000 } }));
});
