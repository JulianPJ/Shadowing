import type { SyncData, SyncedLesson } from './types';
import { emptySync, syncCollections } from './types';

export function mergeLesson(a: SyncedLesson, b: SyncedLesson): SyncedLesson {
  const newer = a.updatedAt > b.updatedAt ? a : b;
  return {
    ...newer,
    completed: a.completed || b.completed,
    completedAt:
      [a.completedAt, b.completedAt]
        .filter((d): d is string => !!d)
        .sort()
        .at(-1) ?? null,
  };
}
export function mergeSync(a: SyncData, b: SyncData): SyncData {
  const result = emptySync();
  result.preferences = !a.preferences
    ? b.preferences
    : !b.preferences
      ? a.preferences
      : a.preferences.updatedAt > b.preferences.updatedAt
        ? a.preferences
        : b.preferences;
  for (const kind of syncCollections) {
    const rows = new Map<string, SyncData[typeof kind][number]>();
    for (const item of [...a[kind], ...b[kind]]) {
      const old = rows.get(item.id);
      if (!old) {
        rows.set(item.id, item);
        continue;
      }
      if (kind === 'lessons') {
        rows.set(item.id, mergeLesson(old as SyncedLesson, item as SyncedLesson));
        continue;
      }
      const time = (x: typeof item) => ('generatedAt' in x ? x.generatedAt : x.updatedAt);
      // A deletion wins ties so an offline add cannot resurrect a bookmark.
      if (
        time(item) > time(old) ||
        (time(item) === time(old) && kind === 'bookmarks' && 'deleted' in item && item.deleted)
      )
        rows.set(item.id, item);
    }
    Object.assign(result, { [kind]: [...rows.values()] });
  }
  return result;
}
