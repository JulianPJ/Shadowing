import type { Lesson } from '../types';
import { migrateLesson, lessonMedia } from '../media';
import { readStorage, writeStorage, writeStorageIfChanged, storageAccount } from './browser';
export type StudyRecord = { lesson: Lesson; index: number; updatedAt: number };

// Local object URLs survive client-side navigation, but intentionally not a full refresh.
const liveMedia = new Map<string, string>();

export function getLiveMedia(id: string) {
  return liveMedia.get(id);
}

export function rememberMedia(id: string, url: string) {
  const previous = liveMedia.get(id);
  if (previous && previous !== url) URL.revokeObjectURL(previous);
  liveMedia.set(id, url);
  if (liveMedia.size > 8) {
    const oldest = liveMedia.keys().next().value!;
    URL.revokeObjectURL(liveMedia.get(oldest)!);
    liveMedia.delete(oldest);
  }
}

export function saveLesson(lesson: Lesson, index: number) {
  if (!storageAccount()) writeStorage(`lesson-visibility:${lesson.id}`, 'anonymous');
  else if (!readStorage(`lesson:${lesson.id}`, null))
    writeStorage(`lesson-visibility:${lesson.id}`, 'account-only');
  lesson = migrateLesson(lesson);
  const local = lessonMedia(lesson).type === 'local';
  if (local && lesson.mediaUrl) rememberMedia(lesson.id, lesson.mediaUrl);
  const rawHistory = readStorage<StudyRecord[]>('history', []);
  const history = Array.isArray(rawHistory)
    ? rawHistory.filter((item) => item?.lesson?.id && Array.isArray(item.lesson.segments))
    : [];
  // Object URLs don't survive reload; keep the transcript and prompt to reattach the media.
  const safeLesson = local ? { ...lesson, mediaUrl: undefined } : lesson;
  writeStorage(
    'history',
    [
      { lesson: safeLesson, index, updatedAt: Date.now() },
      ...history.filter((item) => item.lesson.id !== lesson.id),
    ].slice(0, 8),
  );
  writeStorageIfChanged(`lesson:${lesson.id}`, safeLesson);
  writeStorage(`position:${lesson.id}`, index);
}

export function loadLesson(id: string): Lesson | null {
  const raw = readStorage<Lesson | null>(`lesson:${id}`, null);
  try {
    return raw && raw.id === id && Array.isArray(raw.segments) ? migrateLesson(raw) : null;
  } catch {
    return null;
  }
}

export function recentLessons(): StudyRecord[] {
  const raw = readStorage<StudyRecord[]>('history', []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    try {
      return item?.lesson?.segments?.length
        ? [{ ...item, lesson: migrateLesson(item.lesson) }]
        : [];
    } catch {
      return [];
    }
  });
}
