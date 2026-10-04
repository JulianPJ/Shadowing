import type { LessonQuiz, QuizAttempt, QuizLesson } from '../types';
import { QuizValidationError, object, keys, text } from '../transcript-validation';

import { mapEvidence } from './questions';
import { isoDate } from './document';
export function scoreQuiz(quiz: LessonQuiz, answers: number[]) {
  if (!Array.isArray(answers) || answers.length > quiz.questions.length)
    throw new QuizValidationError('Invalid answers.');
  const results = answers.map((selectedIndex, i) => {
    const q = quiz.questions[i];
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= q.options.length)
      throw new QuizValidationError('Invalid selected option.');
    return {
      questionId: q.id,
      kind: q.kind,
      selectedIndex,
      correctIndex: q.correctIndex,
      correct: selectedIndex === q.correctIndex,
      evidence: q.evidence,
    };
  });
  return {
    results,
    score: results.filter((r) => r.correct).length,
    totalQuestions: quiz.questions.length,
  };
}

export function newAttempt(quiz: LessonQuiz, lesson: QuizLesson): QuizAttempt {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    lessonId: lesson.id,
    ...(lesson.videoId ? { videoId: lesson.videoId } : {}),
    quizId: quiz.id,
    transcriptKey: quiz.transcriptKey,
    quizAttempted: true,
    startedAt: now,
    updatedAt: now,
    completedAt: null,
    ...scoreQuiz(quiz, []),
  };
}

export function updateAttempt(
  attempt: QuizAttempt,
  quiz: LessonQuiz,
  answers: number[],
  finish = false,
): QuizAttempt {
  const scored = scoreQuiz(quiz, answers);
  if (finish && answers.length !== quiz.questions.length)
    throw new QuizValidationError('Answer every question before finishing.');
  const now = new Date().toISOString();
  return { ...attempt, ...scored, updatedAt: now, completedAt: finish ? now : null };
}

export function validateAttempt(value: unknown, quiz: LessonQuiz, lesson: QuizLesson): QuizAttempt {
  const raw = object(value);
  keys(raw, [
    'schemaVersion',
    'id',
    'lessonId',
    'videoId',
    'quizId',
    'transcriptKey',
    'quizAttempted',
    'startedAt',
    'updatedAt',
    'completedAt',
    'score',
    'totalQuestions',
    'results',
  ]);
  if (
    raw.schemaVersion !== 1 ||
    raw.quizAttempted !== true ||
    raw.lessonId !== lesson.id ||
    raw.videoId !== lesson.videoId ||
    raw.quizId !== quiz.id ||
    raw.transcriptKey !== quiz.transcriptKey ||
    !Array.isArray(raw.results)
  )
    throw new QuizValidationError('Invalid attempt.');
  const scored = scoreQuiz(
    quiz,
    raw.results.map((r) => object(r).selectedIndex as number),
  );
  if (raw.score !== scored.score || raw.totalQuestions !== scored.totalQuestions)
    throw new QuizValidationError('Invalid stored score.');
  raw.results.forEach((value, i) => {
    const r = object(value),
      expected = scored.results[i];
    keys(r, ['questionId', 'kind', 'selectedIndex', 'correctIndex', 'correct', 'evidence']);
    if (
      r.questionId !== expected.questionId ||
      r.kind !== expected.kind ||
      r.correctIndex !== expected.correctIndex ||
      r.correct !== expected.correct ||
      JSON.stringify(mapEvidence(r.evidence, lesson.segments)) !== JSON.stringify(expected.evidence)
    )
      throw new QuizValidationError('Invalid stored result.');
  });
  const startedAt = isoDate(raw.startedAt),
    updatedAt = isoDate(raw.updatedAt);
  const completedAt = raw.completedAt === null ? null : isoDate(raw.completedAt);
  if (
    updatedAt < startedAt ||
    (completedAt &&
      (scored.results.length !== quiz.questions.length ||
        completedAt < startedAt ||
        completedAt > updatedAt))
  )
    throw new QuizValidationError('Invalid completion.');
  return {
    schemaVersion: 1,
    id: text(raw.id, 200),
    lessonId: lesson.id,
    ...(lesson.videoId ? { videoId: lesson.videoId } : {}),
    quizId: quiz.id,
    transcriptKey: quiz.transcriptKey,
    quizAttempted: true,
    startedAt,
    updatedAt,
    completedAt,
    ...scored,
  };
}
