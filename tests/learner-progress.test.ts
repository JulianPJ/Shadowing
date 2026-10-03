import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import demo from '../src/data/demo.json';
import quizData from '../src/data/demo-quiz.json';
import difficultyData from '../src/data/demo-difficulty.json';
import type { Lesson } from '../src/lib/types';
import { PlaybackActivity, PracticeClock } from '../src/lib/practice-clock';
import { PracticeCheckpoint } from '../src/lib/practice-checkpoint';
import { aggregateProfile, compactHistory, contentSummary, createSession, DETAIL_SESSION_LIMIT, emptyHistory, lessonIdentity, recordSignal, RESUME_WINDOW_MS, resumableSession, upsertSession, validateHistory, validateSession } from '../src/lib/learner-progress';
import { availableLesson, currentBookmarks, loadLearnerHistory, loadQuizHistory, migrateLearnerHistory, savePracticeSession } from '../src/lib/learner-storage';
import { completeLesson, loadFavorites, loadTranslationCache, readStorage, saveDifficulty, saveLesson, saveQuizAttempt, writeStorage } from '../src/lib/storage';
import { createQuiz, newAttempt, transcriptKey, updateAttempt } from '../src/lib/quiz';
import { createDifficultyAnalysis } from '../src/lib/difficulty';
import type { LearnerProfile, PracticeSession } from '../src/lib/learner-types';

const lesson = demo as Lesson, time = '2026-10-04T12:00:00.000Z';
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => { memory.set(k, v); }, key: (i: number) => [...memory.keys()][i] ?? null, get length() { return memory.size; } } });
});
async function session(): Promise<PracticeSession> { return createSession(lessonIdentity(lesson, await transcriptKey(lesson)), time); }
function addTime(s: PracticeSession, seconds = 60) { s.activeSeconds = seconds; s.activeByDay = { '2026-10-04': seconds }; }
test('session schema round trips compact versioned metadata and rejects invalid fields/dates/counts/UUIDs', async () => {
  const s = await session(); recordSignal(s, lesson.segments[0], 'replay', time); addTime(s);
  assert.deepEqual(validateSession(s), s);
  for (const patch of [{ schemaVersion: 2 }, { id: 'invalid' }, { audio: 'blob:secret' }, { transcript: lesson.segments }, { startedAt: 'invalid' }, { updatedAt: '2026-10-03T00:00:00.000Z' }, { activeSeconds: -1 }, { activeSeconds: 61 }, { activeSeconds: Infinity }, { sections: [...s.sections, ...s.sections] }, { lesson: { ...s.lesson, transcriptKey: 'wrong' } }]) assert.throws(() => validateSession({ ...s, ...patch }));
  assert.throws(() => validateSession({ ...s, sections: [{ ...s.sections[0], replays: -1 }] }));
});
test('upsert is idempotent, preserves UUID, rejects identity change and keeps distinct sessions', async () => {
  const s = await session(), h = emptyHistory(); upsertSession(h, s); upsertSession(h, structuredClone(s));
  assert.equal(h.sessions.length, 1); assert.equal(h.sessions[0].id, s.id);
  const later = { ...s, id: crypto.randomUUID(), startedAt: '2026-10-05T12:00:00.000Z', updatedAt: '2026-10-05T12:00:00.000Z' };
  upsertSession(h, later); assert.equal(h.sessions.length, 2);
  assert.throws(() => upsertSession(h, { ...s, lesson: { ...s.lesson, transcriptKey: 'a'.repeat(64) } }));
});
test('same-tab reload resumes within 30min; later return, other tab and transcript change do not resume', async () => {
  const s = await session(), h = emptyHistory(); upsertSession(h, s);
  assert.equal(resumableSession(h, s.lesson, s.id, '2026-10-04T12:10:00.000Z')?.id, s.id);
  assert.equal(resumableSession(h, s.lesson, s.id, new Date(Date.parse(time) + RESUME_WINDOW_MS).toISOString()), null);
  assert.equal(resumableSession(h, s.lesson, null, time), null);
  assert.equal(resumableSession(h, { ...s.lesson, transcriptKey: 'a'.repeat(64) }, s.id, time), null);
});
test('active clock has no mount/idle credit and excludes hidden/background time', () => {
  const clock = new PracticeClock(0); assert.equal(clock.sample(1000), 0);
  clock.update(1000, { playing: true }); assert.equal(clock.sample(2000), 1);
  clock.update(2000, { visible: false }); assert.equal(clock.sample(3000), 0);
  clock.update(3000, { visible: true, playing: false }); assert.equal(clock.sample(4000), 0);
});
test('listening needs advancing adapter time; paused, stalled, failed and seeking playback cannot run indefinitely', () => {
  const playback = new PlaybackActivity();
  assert.equal(playback.sample(0, true), false); assert.equal(playback.sample(1, true), true);
  assert.equal(playback.sample(1, true), false); assert.equal(playback.sample(1, true), false);
  assert.equal(playback.sample(2, false), false); assert.equal(playback.sample(3, true), false);
  assert.equal(playback.sample(4, true), true); assert.equal(playback.sample(0, true), false);
  assert.equal(playback.sample(NaN, true), false);
  const clock = new PracticeClock(0); clock.interact(0); let total = 0;
  for (let t = 1; t <= 120; t++) total += clock.update(t * 1000, { playing: playback.sample(0, true) });
  assert.equal(total, 30);
});
test('interaction credits at most 30s, sampling suspension and clock reversal never add time', () => {
  const clock = new PracticeClock(0); clock.interact(0); let total = 0;
  for (let n = 1; n <= 120; n++) total += clock.sample(n * 1000);
  assert.equal(total, 30); assert.equal(clock.sample(999999), 0); assert.equal(clock.sample(0), 0);
});
test('spoken response window is 2x playback duration +5s, clamped 10-60s', () => {
  for (const [duration, speed, expected] of [[1, 1, 10], [8, 1, 21], [8, 0.5, 37], [100, 1, 60]]) {
    const clock = new PracticeClock(0); clock.spokenResponse(0, duration, speed); let total = 0;
    for (let n = 1; n <= 100; n++) total += clock.sample(n * 1000);
    assert.equal(total, expected);
  }
});
test('response and interaction windows combine without shortening either allowance', () => {
  const c = new PracticeClock(0); c.interact(0); c.spokenResponse(0, 1, 1);
  let total = 0; for (let t = 1; t <= 40; t++) total += c.sample(t * 1000);
  assert.equal(total, 30);
  const long = new PracticeClock(0); long.spokenResponse(0, 100, 1); long.interact(0);
  total = 0; for (let t = 1; t <= 70; t++) total += long.sample(t * 1000);
  assert.equal(total, 60);
});
test('recording/listening count while visible, quizzes and difficulty waiting override both', () => {
  const clock = new PracticeClock(0); clock.update(0, { recording: true });
  assert.equal(clock.sample(1000), 1); clock.update(1000, { excluded: true }); assert.equal(clock.sample(2000), 0);
  clock.interact(2000); assert.equal(clock.sample(3000), 0); clock.update(3000, { excluded: false, recording: false }); assert.equal(clock.sample(4000), 0);
});
test('incremental checkpoint samples every second but writes at 15s boundaries, flushes once on leave, and handles failure', () => {
  const c = new PracticeCheckpoint(0); let writes = 0;
  for (let seconds = 1; seconds <= 61; seconds++) { c.mark(); if (c.due(seconds * 1000)) c.flush(seconds * 1000, () => { writes++; return true; }); }
  assert.equal(writes, 4);
  c.flush(61000, () => { writes++; return true; }); c.flush(61000, () => { writes++; return true; });
  assert.equal(writes, 5); c.mark(); assert.equal(c.flush(62000, () => false), false); assert.equal(c.due(80000), false);
  c.mark(); assert.equal(c.due(80000), true);
});
test('legacy completion without a timestamp preserves completion but invents no date or elapsed time', async () => {
  saveLesson(lesson, 0); const { transcriptRevision } = await import('../src/lib/quiz');
  writeStorage('completion:demo', { transcript: transcriptRevision(lesson) });
  const h = await migrateLearnerHistory(); assert.equal(h.sessions[0].completed, true); assert.equal(h.sessions[0].completedAt, null); assert.equal(h.sessions[0].activeSeconds, 0);
});
test('explicit replay/evidence/navigation remain distinct and hiding/restoring translations creates no event', async () => {
  const s = await session(), segment = lesson.segments[0];
  recordSignal(s, segment, 'navigate', time); assert.equal(s.sections[0].replays, 0);
  recordSignal(s, segment, 'evidence-replay', time); assert.equal(s.sections[0].replays, 0);
  recordSignal(s, segment, 'replay', time); recordSignal(s, segment, 'replay', time);
  recordSignal(s, segment, 'translation-reveal', time);
  assert.equal(s.sections[0].replays, 2); assert.equal(s.sections[0].evidenceReplays, 1);
  assert.equal(s.sections[0].translationReveals, 1); assert.equal(s.sections[0].translationHelp, true);
});
test('recording signals persist only counts/section/session metadata without audio or transcript text', async () => {
  const s = await session(); recordSignal(s, lesson.segments[0], 'recording-attempt', time);
  assert.equal(savePracticeSession(s), true); assert.equal(loadLearnerHistory().sessions[0].sections[0].recordingAttempts, 1);
  const serialized = memory.get('hibiki:v1:learner-history')!;
  for (const forbidden of ['blob:', 'japanese', 'mediaUrl', 'translation"', 'quote', 'questions', lesson.segments[0].japanese]) assert.ok(!serialized.includes(forbidden));
});
test('quiz history reuses existing attempts including retakes, drafts, incorrect evidence and damaged record isolation', async () => {
  const s = await session(), h = emptyHistory(); upsertSession(h, s);
  const quiz = await createQuiz(quizData, lesson);
  const first = updateAttempt(newAttempt(quiz, lesson), quiz, quiz.questions.map(q => (q.correctIndex + 1) % 4), true);
  const retake = updateAttempt(newAttempt(quiz, lesson), quiz, quiz.questions.map(q => q.correctIndex), true);
  const draft = updateAttempt(newAttempt(quiz, lesson), quiz, [0]);
  for (const a of [first, retake, draft]) saveQuizAttempt(a, quiz, lesson);
  const raw = readStorage<unknown[]>('quiz-attempts', []); writeStorage('quiz-attempts', [...raw, { ...first, score: 999 }, null]);
  const attempts = loadQuizHistory(); assert.equal(attempts.length, 3);
  const p = aggregateProfile(h, attempts, [], time);
  assert.equal(p.comprehension.attempts, 3); assert.equal(p.comprehension.completed, 2);
  assert.equal(p.comprehension.correct, 5); assert.equal(p.comprehension.total, 10);
  assert.equal(p.comprehension.missedQuestions, 5);
  assert.ok(p.attention.find(s => s.sectionId === first.results[0].evidence.segmentIds[0])?.missedQuestions);
});
test('analysis generated after practice joins exact lesson/transcript revision with compact dimensions', async () => {
  const s = await session(); addTime(s); savePracticeSession(s);
  const analysis = await createDifficultyAnalysis(difficultyData, lesson); await saveDifficulty(analysis, lesson);
  const p = aggregateProfile(loadLearnerHistory(), [], [], time); assert.equal(p.lessons[0].difficulty?.id, analysis.id);
  assert.equal(p.lessons[0].difficulty?.vocabulary, analysis.vocabulary.level);
  assert.equal(p.typicalContent, null);
  const changed = { ...s, id: crypto.randomUUID(), lesson: { ...s.lesson, transcriptKey: 'a'.repeat(64) } }; savePracticeSession(changed);
  const revisions = aggregateProfile(loadLearnerHistory(), [], [], time).lessons;
  assert.equal(revisions.length, 2); assert.equal(revisions.find(l => l.lesson.transcriptKey === 'a'.repeat(64))!.difficulty, null);
});
async function analyzedLessons(levels: ('N5' | 'N4' | 'N3' | 'N2' | 'N1')[]) {
  const s = await session();
  return levels.map((level, i): LearnerProfile['lessons'][number] => ({ lesson: { ...s.lesson, lessonId: `lesson-${i}` }, practised: true, completed: true, activeSeconds: 60, sessions: 1, lastSectionId: null, lastPractisedAt: new Date(Date.parse(time) - i * 86400000).toISOString(), quizAttempts: 0, quizCompleted: 0, difficulty: { ...compactDifficultyReference(s), lessonId: `lesson-${i}`, jlptMin: level, jlptMax: level } }));
}
function compactDifficultyReference(s: PracticeSession) { return { schemaVersion: 1 as const, id: `difficulty:v1:${s.lesson.lessonId}:${s.lesson.transcriptKey}`, lessonId: s.lesson.lessonId, transcriptKey: s.lesson.transcriptKey, generatedAt: time, jlptMin: 'N4' as const, jlptMax: 'N3' as const, vocabulary: 2 as const, grammar: 2 as const, speechSpeed: 2 as const, conversationalComplexity: 2 as const }; }
test('typical content needs 5 unique practised analyzed lessons; median resists one outlier and duplicate refreshes', async () => {
  const lessons = await analyzedLessons(['N3', 'N3', 'N3', 'N3', 'N1']);
  assert.equal(contentSummary(lessons.slice(0, 4)).typicalContent, null);
  assert.deepEqual(contentSummary([...lessons, lessons[0]]).typicalContent, { min: 'N3', max: 'N3', lessons: 5 });
  assert.equal(contentSummary(lessons.map(l => ({ ...l, practised: false }))).typicalContent, null);
});
test('conservative trend compares two groups of 5 unique lessons; no two-lesson trend', async () => {
  for (const [newer, older, expected] of [['N3', 'N4', 'harder'], ['N4', 'N3', 'easier'], ['N3', 'N3', 'similar']] as const) {
    const l = await analyzedLessons([...Array(5).fill(newer), ...Array(5).fill(older)]);
    assert.equal(contentSummary(l).contentTrend, expected); assert.equal(contentSummary(l.slice(0, 9)).contentTrend, null);
  }
});
test('attention ranks simple transparent signals and bookmark removal is current state rather than lifetime adds', async () => {
  const s = await session(), h = emptyHistory(); recordSignal(s, lesson.segments[0], 'replay', time); recordSignal(s, lesson.segments[0], 'translation-reveal', time);
  recordSignal(s, lesson.segments[1], 'recording-attempt', time); recordSignal(s, lesson.segments[1], 'recording-attempt', time); upsertSession(h, s);
  const bookmarks = [{ lesson: s.lesson, sections: [{ sectionId: lesson.segments[0].id, start: lesson.segments[0].start, end: lesson.segments[0].end }] }];
  const p = aggregateProfile(h, [], bookmarks, time); assert.equal(p.bookmarks, 1); assert.equal(p.attention[0].rank, 5); assert.ok(p.attention[0].reasons.includes('Saved section'));
  assert.equal(aggregateProfile(h, [], [], time).bookmarks, 0);
});
test('migration scans uncapped lessons, is idempotent, preserves known completion/reveal/bookmark facts without fabricated counts/time', async () => {
  saveLesson(lesson, 3); completeLesson(lesson); writeStorage('reveal:demo:segment-1', true); writeStorage('favorites:demo', ['segment-1', 'missing']);
  const first = await migrateLearnerHistory(), second = await migrateLearnerHistory(); assert.deepEqual(first, second);
  assert.equal(first.sessions.length, 1); const s = first.sessions[0]; assert.equal(s.origin, 'legacy'); assert.equal(s.startedAt, null); assert.equal(s.activeSeconds, 0); assert.ok(s.completedAt);
  assert.equal(s.sections[0].translationHelp, true); assert.equal(s.sections[0].translationReveals, 0);
  const bookmarks = await currentBookmarks([s.lesson]); assert.equal(bookmarks[0].sections.length, 1);
  assert.equal(aggregateProfile(first, [], bookmarks, time).completedLessons, 1);
  for (let i = 0; i < 10; i++) saveLesson({ ...lesson, id: `extra-${i}` }, 0);
  assert.equal((await migrateLearnerHistory()).sessions.length, 11);
  assert.equal(availableLesson('missing'), null);
});
test('malformed history/legacy storage isolates damage and never crashes', async () => {
  memory.set('hibiki:v1:history', '{}'); memory.set('hibiki:v1:lesson:broken', 'null'); memory.set('hibiki:v1:learner-history', '{malformed');
  assert.deepEqual(await migrateLearnerHistory(), emptyHistory());
  const s = await session(); assert.equal(validateHistory({ ...emptyHistory(), sessions: [null, s, { ...s, id: 'bad' }] }).sessions.length, 1);
  saveLesson(lesson, 0); assert.ok(availableLesson('demo'));
  writeStorage('favorites:demo', { invalid: true }); writeStorage('translations:demo', null);
  assert.deepEqual(loadFavorites(lesson), []); assert.deepEqual(loadTranslationCache('demo'), {});
  writeStorage('favorites:demo', ['segment-1', 'segment-1', 'missing', 4]);
  assert.deepEqual(loadFavorites(lesson), ['segment-1']);
});
test('unsupported future history versions are preserved instead of being overwritten by backfill', async () => {
  writeStorage('learner-history', { schemaVersion: 2, futureData: 'preserve' });
  assert.equal(savePracticeSession(await session()), false);
  assert.deepEqual(readStorage('learner-history', null), { schemaVersion: 2, futureData: 'preserve' });
});
test('retention compacts beyond 500 sessions atomically, retaining lifetime totals, dates and section reasons', async () => {
  const s = await session(), h = emptyHistory();
  for (let i = 0; i < DETAIL_SESSION_LIMIT + 5; i++) { const next = structuredClone(s); next.id = crypto.randomUUID(); next.updatedAt = new Date(Date.parse(time) + i * 1000).toISOString(); addTime(next); recordSignal(next, lesson.segments[0], 'replay', next.updatedAt); h.sessions.push(next); }
  const before = aggregateProfile(h, [], [], time), compact = compactHistory(h), after = aggregateProfile(validateHistory(compact), [], [], time);
  assert.equal(compact.sessions.length, 500); assert.equal(compact.archives.length, 1);
  for (const field of ['activeSeconds', 'recentActiveSeconds', 'sessionCount', 'distinctLessons', 'replays'] as const) assert.equal(after[field], before[field]);
  assert.deepEqual(compactHistory(compact), compact);
});
test('aggregation is deterministic without mutating inputs and combines dates/session histories', async () => {
  const s = await session(), h = emptyHistory(); addTime(s); recordSignal(s, lesson.segments[0], 'replay', time); h.sessions.push(s);
  const original = structuredClone(h); assert.deepEqual(aggregateProfile(h, [], [], time), aggregateProfile(h, [], [], time)); assert.deepEqual(h, original);
  const old = structuredClone(s); old.id = crypto.randomUUID(); old.activeByDay = { '2025-01-01': 60 }; h.sessions.push(old);
  const p = aggregateProfile(h, [], [], time); assert.equal(p.activeSeconds, 120); assert.equal(p.recentActiveSeconds, 60); assert.equal(p.distinctLessons, 1); assert.equal(p.sessionCount, 2);
});
test('storage quota failure is non-fatal and visit data remains readable in memory', async () => {
  const s = await session();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('quota'); } } });
  assert.equal(savePracticeSession(s), false); assert.equal(loadLearnerHistory().sessions[0].id, s.id);
  assert.equal(savePracticeSession(s), false); assert.equal(loadLearnerHistory().sessions.length, 1);
});
