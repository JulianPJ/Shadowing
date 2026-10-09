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
  // Object URLs don't survive reload; keep the transcript and prompt to reattach the media.
  const safeLesson = local ? { ...lesson, mediaUrl: undefined } : lesson;
  writeStorageIfChanged(`lesson:${lesson.id}`, safeLesson);
  writeStorage(
    'history',
    [
      { lesson: { id: lesson.id }, index, updatedAt: Date.now() },
      ...compactHistory().filter((item) => item.lesson.id !== lesson.id),
    ].slice(0, 8),
  );
  writeStorage(`position:${lesson.id}`, index);
}

/** Section navigation only moves the position; the transcript and recent order are unchanged. */
export function saveLessonPosition(lessonId: string, index: number) {
  writeStorageIfChanged(`position:${lessonId}`, index);
}

export function loadLesson(id: string): Lesson | null {
  const raw = readStorage<Lesson | null>(`lesson:${id}`, null);
  try {
    return raw && raw.id === id && Array.isArray(raw.segments) ? migrateLesson(raw) : null;
  } catch {
    return null;
  }
}

type HistoryReference = { lesson: { id: string }; index: number; updatedAt: number };

/**
 * Recent history stores references; each transcript lives once under `lesson:{id}`.
 * Older entries embedded the full lesson, which is moved to its canonical key on rewrite.
 */
function compactHistory(): HistoryReference[] {
  const raw = readStorage<unknown>('history', []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: Partial<StudyRecord> | null) => {
    const id = item?.lesson?.id;
    if (typeof id !== 'string' || !id) return [];
    if (Array.isArray(item?.lesson?.segments) && !readStorage(`lesson:${id}`, null))
      writeStorageIfChanged(`lesson:${id}`, item.lesson);
    return [
      {
        lesson: { id },
        index: Number.isSafeInteger(item?.index) ? item!.index! : 0,
        updatedAt: Number(item?.updatedAt) || 0,
      },
    ];
  });
}

export function recentLessons(): StudyRecord[] {
  const raw = readStorage<unknown>('history', []);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item: Partial<StudyRecord> | null) => {
    try {
      const id = item?.lesson?.id;
      if (typeof id !== 'string') return [];
      const lesson =
        loadLesson(id) ??
        (item?.lesson?.segments?.length ? migrateLesson(item.lesson as Lesson) : null);
      if (!lesson?.segments.length) return [];
      const position = readStorage<number>(`position:${id}`, item?.index ?? 0);
      return [
        {
          lesson,
          index: Number.isSafeInteger(position)
            ? Math.max(0, Math.min(lesson.segments.length - 1, position))
            : 0,
          updatedAt: Number(item?.updatedAt) || 0,
        },
      ];
    } catch {
      return [];
    }
  });
}
