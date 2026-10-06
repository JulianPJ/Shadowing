import { test } from 'node:test';
import assert from 'node:assert/strict';
import demo from '../src/data/demo.json' with { type: 'json' };
import questions from '../src/data/demo-quiz.json' with { type: 'json' };
import { completionRevisitSections } from '../src/lib/lesson-completion';
import { createShadowingSession, upsertShadowingSection } from '../src/lib/shadowing-session';
import { scoreShadowingAttempt } from '../src/lib/shadowing-score';
import { createQuiz, newAttempt, updateAttempt } from '../src/lib/quiz';
import { transcriptRevision } from '../src/lib/transcript';
import type { Lesson } from '../src/lib/types';
const lesson = demo as Lesson;
test('no evidence gives no revisit sections; bookmarks are bounded, ordered and deduplicated', () => {
  const session = createShadowingSession(lesson.id, transcriptRevision(lesson));
  assert.deepEqual(completionRevisitSections(lesson, session, null, [], null), []);
  const result = completionRevisitSections(
    lesson,
    session,
    null,
    ['missing', ...lesson.segments.map((s) => s.id), lesson.segments[0].id],
    null,
  );
  assert.deepEqual(
    result,
    [0, 1, 2].map((index) => ({ index, reason: 'Bookmarked' })),
  );
});
test('lowest latest valid match attempt is explainable and ignores another transcript revision', () => {
  const session = createShadowingSession(lesson.id, transcriptRevision(lesson));
  const result = {
    ...scoreShadowingAttempt({
      targetText: '朝です',
      recognizedText: '朝',
      referenceDurationSeconds: 2,
      recordingDurationSeconds: 2,
    }),
    sectionId: lesson.segments[4].id,
    attemptedAt: '2026-10-01T00:00:00.000Z',
    suggestions: [],
  };
  const scored = upsertShadowingSection(session, lesson.id, session.transcriptRevision, result);
  assert.deepEqual(completionRevisitSections(lesson, scored, null, [], null), [
    { index: 4, reason: 'Lowest Shadowing Match attempt' },
  ]);
  assert.deepEqual(
    completionRevisitSections(lesson, { ...scored, transcriptRevision: 'stale' }, null, [], null),
    [],
  );
});
test('only completed matching comprehension evidence contributes; no speculative score', async () => {
  const quiz = await createQuiz(questions, lesson),
    session = createShadowingSession(lesson.id, transcriptRevision(lesson));
  const attempt = updateAttempt(
    newAttempt(quiz, lesson),
    quiz,
    quiz.questions.map((q) => (q.correctIndex + 1) % q.options.length),
    true,
  );
  assert.equal(
    completionRevisitSections(lesson, session, attempt, [], quiz.transcriptKey).length,
    3,
  );
  assert.deepEqual(
    completionRevisitSections(
      lesson,
      session,
      { ...attempt, completedAt: null },
      [],
      quiz.transcriptKey,
    ),
    [],
  );
  assert.deepEqual(completionRevisitSections(lesson, session, attempt, [], 'b'.repeat(64)), []);
});
