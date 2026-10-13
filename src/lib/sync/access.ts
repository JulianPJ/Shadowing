import { emptySync, type SyncData } from './types';

/** Free sync carries viewer preferences and recently opened lesson positions only. */
export function basicSyncData(data: SyncData): SyncData {
  return {
    ...emptySync(),
    preferences: data.preferences ? { ...data.preferences, reviewLimits: undefined } : null,
    lessons: data.lessons.map((lesson) => ({ ...lesson, completed: false, completedAt: null })),
  };
}
export function hasLearningData(data: SyncData) {
  return (
    data.sessions.length ||
    data.attempts.length ||
    data.bookmarks.length ||
    data.difficulties.length ||
    data.archives.length ||
    data.preferences?.reviewLimits ||
    data.lessons.some((lesson) => lesson.completed || lesson.completedAt)
  );
}
