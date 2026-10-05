import type { ContentDifficultyAnalysis, LessonQuiz, QuizAttempt, QuizLesson } from '../types';
import { validateDifficultyAnalysis } from '../difficulty';
import { transcriptRevision } from '../transcript';
import { validateAttempt, validateQuiz } from '../quiz';
import {
  ARCHIVE_LIMIT,
  HISTORY_BYTE_LIMIT,
  compactDifficulty,
  compactHistory,
  emptyHistory,
  validateHistory,
} from '../learner-progress';
import type { LearnerHistory } from '../learner-types';
import { reportStorageFailure, readStorage, writeStorage, storageAccount } from './browser';
export function writeLearnerHistory(history: LearnerHistory, protectedId?: string) {
  const existing = readStorage<{ schemaVersion?: unknown } | null>('learner-history', null);
  if (existing && typeof existing.schemaVersion === 'number' && existing.schemaVersion !== 1) {
    reportStorageFailure();
    return false;
  }
  // Preserve immutable IDs in account caches; remote hydration must not double-count archives.
  const compact = storageAccount() ? history : compactHistory(history, protectedId);
  if (
    compact.archives.length > ARCHIVE_LIMIT ||
    JSON.stringify(compact).length * 2 > HISTORY_BYTE_LIMIT
  ) {
    reportStorageFailure();
    return false;
  }
  return writeStorage('learner-history', compact);
}

export function lessonCompleted(lesson: QuizLesson) {
  return (
    readStorage<{ transcript: string } | null>(`completion:${lesson.id}`, null)?.transcript ===
    transcriptRevision(lesson)
  );
}

export function completeLesson(lesson: QuizLesson) {
  return writeStorage(`completion:${lesson.id}`, {
    lessonId: lesson.id,
    transcript: transcriptRevision(lesson),
    completedAt: new Date().toISOString(),
  });
}

export async function loadQuiz(lesson: QuizLesson): Promise<LessonQuiz | null> {
  try {
    return await validateQuiz(readStorage(`quiz:${lesson.id}`, null), lesson);
  } catch {
    return null;
  }
}

export function saveQuiz(quiz: LessonQuiz) {
  return writeStorage(`quiz:${quiz.lessonId}`, quiz);
}

export async function loadDifficulty(
  lesson: QuizLesson,
): Promise<ContentDifficultyAnalysis | null> {
  try {
    return await validateDifficultyAnalysis(readStorage(`difficulty:${lesson.id}`, null), lesson);
  } catch {
    return null;
  }
}

export async function saveDifficulty(analysis: ContentDifficultyAnalysis, lesson: QuizLesson) {
  try {
    const safe = await validateDifficultyAnalysis(analysis, lesson);
    const saved = writeStorage(`difficulty:${lesson.id}`, safe);
    const history = validateHistory(readStorage('learner-history', emptyHistory()));
    history.difficulties = [
      ...history.difficulties.filter((d) => d.id !== safe.id),
      compactDifficulty(safe),
    ];
    return writeLearnerHistory(history) && saved;
  } catch {
    return false;
  }
}

export function loadQuizAttempt(quiz: LessonQuiz, lesson: QuizLesson): QuizAttempt | null {
  try {
    return validateAttempt(readStorage(`quiz-attempt:${quiz.id}`, null), quiz, lesson);
  } catch {
    return null;
  }
}

export function saveQuizAttempt(attempt: QuizAttempt, quiz: LessonQuiz, lesson: QuizLesson) {
  const safe = validateAttempt(attempt, quiz, lesson);
  // One upserted event per attempt; an explicit retake creates a new ID.
  const history = readStorage<unknown>('quiz-attempts', []);
  const records = Array.isArray(history)
    ? history.filter((item) => item && typeof item === 'object' && item.id !== safe.id)
    : [];
  const historySaved = writeStorage('quiz-attempts', [...records, safe]);
  const draftSaved = writeStorage(`quiz-attempt:${quiz.id}`, safe);
  return historySaved && draftSaved;
}
