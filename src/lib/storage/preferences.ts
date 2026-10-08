import type { Lesson, Mode } from '../types';
import { readStorage } from './browser';
import { normalizeReviewLimits, type ReviewLimits } from '../review/limits';
export const PLAYBACK_OFFSET_MIN_MS = -2000;
export const PLAYBACK_OFFSET_MAX_MS = 2000;
export const PLAYBACK_OFFSET_STEP_MS = 50;

export type Preferences = {
  mode: Mode;
  speed: number;
  translation: boolean;
  studioMode: boolean;
  furigana: boolean;
  playbackOffsetMs: number;
  reviewLimits?: ReviewLimits;
};

export function normalizePlaybackOffsetMs(value: unknown) {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= PLAYBACK_OFFSET_MIN_MS &&
    value <= PLAYBACK_OFFSET_MAX_MS
    ? Math.round(value)
    : 0;
}

export function loadPreferences(): Preferences {
  const raw = readStorage<Partial<Preferences> | null>('preferences', null);
  return {
    mode: raw?.mode === 'continuous' ? 'continuous' : 'shadowing',
    speed: [0.5, 0.75, 1, 1.25].includes(raw?.speed as number) ? raw!.speed! : 1,
    translation: false,
    studioMode: raw?.studioMode === true,
    furigana: raw?.furigana === true,
    playbackOffsetMs: normalizePlaybackOffsetMs(raw?.playbackOffsetMs),
    ...(raw?.reviewLimits === undefined
      ? {}
      : { reviewLimits: normalizeReviewLimits(raw.reviewLimits) }),
  };
}

export function loadFavorites(lesson: Lesson): string[] {
  const raw = readStorage<unknown>(`favorites:${lesson.id}`, []);
  const valid = new Set(lesson.segments.map((s) => s.id));
  return Array.isArray(raw)
    ? [...new Set(raw.filter((id): id is string => typeof id === 'string' && valid.has(id)))]
    : [];
}

export const TRANSLATION_CACHE_VERSION = 3;

export function translationCacheKey(lessonId: string) {
  return `translations:v${TRANSLATION_CACHE_VERSION}:${lessonId}`;
}

export function loadTranslationCache(lessonId: string): Record<string, string> {
  const raw = readStorage<unknown>(translationCacheKey(lessonId), {});
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter(
      (entry): entry is [string, string] =>
        typeof entry[1] === 'string' && entry[1].length <= 10000,
    ),
  );
}
