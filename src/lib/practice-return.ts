import { lessonMedia } from './media';
import { storageAccount } from './storage/browser';
import { transcriptRevision } from './transcript';
import type { Lesson } from './types';

const key = 'hibiki:practice-return';
const maxAge = 30 * 60 * 1000;
export type PracticeReturn = { index: number; mediaTime: number };

function source(lesson: Lesson) {
  const media = lessonMedia(lesson);
  return JSON.stringify([media, media.type === 'local' ? (lesson.mediaUrl ?? null) : null]);
}

export function rememberPracticeReturn(lesson: Lesson, index: number, mediaTime: number) {
  if (!Number.isFinite(mediaTime) || mediaTime < 0) return;
  try {
    sessionStorage.setItem(
      key,
      JSON.stringify({
        lessonId: lesson.id,
        transcript: transcriptRevision(lesson),
        source: source(lesson),
        owner: storageAccount(),
        savedAt: Date.now(),
        index,
        mediaTime,
      }),
    );
  } catch {
    // Returning at the saved section remains available when session storage is blocked.
  }
}

export function loadPracticeReturn(lesson: Lesson): PracticeReturn | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null');
    if (!value) return null;
    const age = Date.now() - value.savedAt;
    if (
      !Number.isFinite(value.savedAt) ||
      age < 0 ||
      age > maxAge ||
      value.owner !== storageAccount()
    ) {
      sessionStorage.removeItem(key);
      return null;
    }
    if (value.lessonId !== lesson.id) return null;
    const query = new URLSearchParams(window.location.search);
    if (
      query.has('section') ||
      query.has('transcript') ||
      query.has('quiz') ||
      query.has('lookup')
    ) {
      clearPracticeReturn();
      return null;
    }
    if (
      value.transcript !== transcriptRevision(lesson) ||
      value.source !== source(lesson) ||
      !Number.isInteger(value.index) ||
      value.index < 0 ||
      value.index >= lesson.segments.length ||
      !Number.isFinite(value.mediaTime) ||
      value.mediaTime < 0 ||
      value.mediaTime > lesson.segments.at(-1)!.end + 5
    ) {
      clearPracticeReturn();
      return null;
    }
    return { index: value.index, mediaTime: value.mediaTime };
  } catch {
    return null;
  }
}

export function clearPracticeReturn() {
  try {
    sessionStorage.removeItem(key);
  } catch {
    /* Optional browser state. */
  }
}
