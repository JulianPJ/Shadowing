import type { ContentDifficultyAnalysis, Lesson, LessonQuiz, Mode, QuizAttempt, QuizLesson } from './types';
import { validateDifficultyAnalysis } from './difficulty';
import { transcriptRevision, validateAttempt, validateQuiz } from './quiz';
import { ARCHIVE_LIMIT, HISTORY_BYTE_LIMIT, compactDifficulty, compactHistory, emptyHistory, validateHistory } from './learner-progress';
import type { LearnerHistory } from './learner-types';
export type StudyRecord = { lesson: Lesson; index: number; updatedAt: number };
export type Preferences = { mode: Mode; speed: number; translation: boolean };
const PREFIX = 'hibiki:v1:';
const unsaved = new Map<string, unknown>();
let storageFailed = false;
export function progressStorageFailed() { return storageFailed; }
export function reportStorageFailure() {
  storageFailed = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hibiki:storage-warning'));
}
export function storageKeys(): string[] {
  const keys = new Set<string>(unsaved.keys());
  try { for (let i = 0; i < localStorage.length; i++) { const key = localStorage.key(i); if (key?.startsWith(PREFIX)) keys.add(key.slice(PREFIX.length)); } }
  catch { reportStorageFailure(); }
  return [...keys];
}
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
  if (unsaved.has(key)) return structuredClone(unsaved.get(key)) as T;
  try { const value = localStorage.getItem(PREFIX + key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}
export function writeStorage(key: string, value: unknown) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); unsaved.delete(key); return true; }
  catch { unsaved.set(key, structuredClone(value)); reportStorageFailure(); return false; /* Playback still works. */ }
}
export function writeLearnerHistory(history: LearnerHistory, protectedId?: string) {
  const existing = readStorage<{ schemaVersion?: unknown } | null>('learner-history', null);
  if (existing && typeof existing.schemaVersion === 'number' && existing.schemaVersion !== 1) { reportStorageFailure(); return false; }
  const compact = compactHistory(history, protectedId);
  if (compact.archives.length > ARCHIVE_LIMIT || JSON.stringify(compact).length * 2 > HISTORY_BYTE_LIMIT) { reportStorageFailure(); return false; }
  return writeStorage('learner-history', compact);
}
export function loadFavorites(lesson: Lesson): string[] {
  const raw = readStorage<unknown>(`favorites:${lesson.id}`, []);
  const valid = new Set(lesson.segments.map(s => s.id));
  return Array.isArray(raw) ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && valid.has(id)))] : [];
}
export const TRANSLATION_CACHE_VERSION = 3;
export function translationCacheKey(lessonId: string) {
  return `translations:v${TRANSLATION_CACHE_VERSION}:${lessonId}`;
}
export function loadTranslationCache(lessonId: string): Record<string, string> {
  const raw = readStorage<unknown>(translationCacheKey(lessonId), {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length <= 10000));
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
export async function loadDifficulty(lesson: QuizLesson): Promise<ContentDifficultyAnalysis | null> {
  try { return await validateDifficultyAnalysis(readStorage(`difficulty:${lesson.id}`, null), lesson); } catch { return null; }
}
export async function saveDifficulty(analysis: ContentDifficultyAnalysis, lesson: QuizLesson) {
  try {
    const safe = await validateDifficultyAnalysis(analysis, lesson);
    const saved = writeStorage(`difficulty:${lesson.id}`, safe);
    const history = validateHistory(readStorage('learner-history', emptyHistory()));
    history.difficulties = [...history.difficulties.filter(d => d.id !== safe.id), compactDifficulty(safe)];
    return writeLearnerHistory(history) && saved;
  } catch { return false; }
}
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
  const rawHistory = readStorage<StudyRecord[]>('history', []);
  const history = Array.isArray(rawHistory) ? rawHistory.filter(item => item?.lesson?.id && Array.isArray(item.lesson.segments)) : [];
  // Object URLs don't survive reload; keep the transcript and prompt to reattach the media.
  const safeLesson = lesson.source === 'upload' ? { ...lesson, mediaUrl: undefined } : lesson;
  writeStorage('history', [{ lesson: safeLesson, index, updatedAt: Date.now() }, ...history.filter(item => item.lesson.id !== lesson.id)].slice(0, 8));
  writeStorage(`lesson:${lesson.id}`, safeLesson);
  writeStorage(`position:${lesson.id}`, index);
}
