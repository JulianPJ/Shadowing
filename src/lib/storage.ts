import type { Lesson, LessonQuiz, Mode, QuizAttempt, QuizLesson } from './types';
import { transcriptRevision, validateAttempt, validateQuiz } from './quiz';
export type StudyRecord = { lesson: Lesson; index: number; updatedAt: number };
export type Preferences = { mode: Mode; speed: number; translation: boolean };
const PREFIX = 'hibiki:v1:';
// Local object URLs survive client-side navigation, but intentionally not a full refresh.
const liveMedia = new Map<string, string>();
export function getLiveMedia(id: string) { return liveMedia.get(id); }
export function rememberMedia(id: string, url: string) {
  const previous = liveMedia.get(id);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  liveMedia.set(id, url);
  if (liveMedia.size > 8) { const oldest = liveMedia.keys().next().value!; URL.revokeObjectURL(liveMedia.get(oldest)!); liveMedia.delete(oldest); }
}
export function readStorage<T>(key: string, fallback: T): T {
  try { const value = localStorage.getItem(PREFIX + key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function writeStorage(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); return true; } catch { return false; /* Playback still works. */ }
}
export function lessonCompleted(lesson: QuizLesson) {
  return readStorage<{ transcript: string } | null>(`completion:${lesson.id}`, null)?.transcript === transcriptRevision(lesson);
}
export function completeLesson(lesson: QuizLesson) {
  return writeStorage(`completion:${lesson.id}`, { lessonId: lesson.id, transcript: transcriptRevision(lesson), completedAt: new Date().toISOString() });
}
export async function loadQuiz(lesson: QuizLesson): Promise<LessonQuiz | null> {
  try { return await validateQuiz(readStorage(`quiz:${lesson.id}`, null), lesson); } catch { return null; }
}
export function saveQuiz(quiz: LessonQuiz) { return writeStorage(`quiz:${quiz.lessonId}`, quiz); }
export function loadQuizAttempt(quiz: LessonQuiz, lesson: QuizLesson): QuizAttempt | null {
  try { return validateAttempt(readStorage(`quiz-attempt:${quiz.id}`, null), quiz, lesson); } catch { return null; }
}
export function saveQuizAttempt(attempt: QuizAttempt, quiz: LessonQuiz, lesson: QuizLesson) {
  const safe = validateAttempt(attempt, quiz, lesson);
  // One upserted event per attempt; an explicit retake creates a new ID.
  const history = readStorage<unknown>('quiz-attempts', []);
  const records = Array.isArray(history) ? history.filter(item => item && typeof item === 'object' && item.id !== safe.id) : [];
  const historySaved = writeStorage('quiz-attempts', [...records, safe]);
  const draftSaved = writeStorage(`quiz-attempt:${quiz.id}`, safe);
  return historySaved && draftSaved;
}
export function saveLesson(lesson: Lesson, index: number) {
  if (lesson.source === 'upload' && lesson.mediaUrl) rememberMedia(lesson.id, lesson.mediaUrl);
  const history = readStorage<StudyRecord[]>('history', []);
  // Object URLs don't survive reload; keep the transcript and prompt to reattach the media.
  const safeLesson = lesson.source === 'upload' ? { ...lesson, mediaUrl: undefined } : lesson;
  writeStorage('history', [{ lesson: safeLesson, index, updatedAt: Date.now() }, ...history.filter(item => item.lesson.id !== lesson.id)].slice(0, 8));
  writeStorage(`lesson:${lesson.id}`, safeLesson);
  writeStorage(`position:${lesson.id}`, index);
}
