import type { LessonQuiz, QuizLesson } from '../types';
import { QuizValidationError, object, keys, text } from '../transcript-validation';
import { transcriptKey } from '../transcript';
import { validateQuestions, filterGeneratedQuestions } from './questions';
export async function createQuiz(value: unknown, lesson: QuizLesson): Promise<LessonQuiz> {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    lessonId: lesson.id,
    transcriptKey: await transcriptKey(lesson),
    generatedAt: new Date().toISOString(),
    questions: validateQuestions(value, lesson),
  };
}

export async function createGeneratedQuiz(value: unknown, lesson: QuizLesson): Promise<LessonQuiz> {
  return {
    schemaVersion: 1,
    id: crypto.randomUUID(),
    lessonId: lesson.id,
    transcriptKey: await transcriptKey(lesson),
    generatedAt: new Date().toISOString(),
    questions: filterGeneratedQuestions(value, lesson),
  };
}

export function isoDate(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    throw new QuizValidationError('Invalid date.');
  return value;
}

export async function validateQuiz(value: unknown, lesson: QuizLesson): Promise<LessonQuiz> {
  const raw = object(value);
  keys(raw, ['schemaVersion', 'id', 'lessonId', 'transcriptKey', 'generatedAt', 'questions']);
  if (
    raw.schemaVersion !== 1 ||
    raw.lessonId !== lesson.id ||
    raw.transcriptKey !== (await transcriptKey(lesson))
  )
    throw new QuizValidationError('This quiz belongs to a different transcript.');
  return {
    schemaVersion: 1,
    id: text(raw.id, 200),
    lessonId: lesson.id,
    transcriptKey: raw.transcriptKey as string,
    generatedAt: isoDate(raw.generatedAt),
    questions: validateQuestions({ questions: raw.questions }, lesson),
  };
}
