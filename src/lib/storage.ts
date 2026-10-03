import type { Lesson, Mode } from './types';
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
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* Private mode or storage full: playback still works. */ }
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
