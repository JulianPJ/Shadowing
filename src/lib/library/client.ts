'use client';
import { loadLesson, recentLessons, type StudyRecord } from '../storage/lessons';
import { readStorage, writeStorage, readDeviceStorage, storageAccount } from '../storage/browser';
import { loadLearnerHistory } from '../learner/persistence';
import { accountLessons } from '../sync/client';
import { emptyLibrary, enqueue, validateLibrary, type LibraryState } from './model';
import { queueEdited } from '../discover/client';

export const loadLibrary = () => validateLibrary(readStorage('library:data', emptyLibrary()));
export function saveLibrary(state: LibraryState, sync = true) {
  const previous = loadLibrary();
  const next = validateLibrary(state);
  const saved = writeStorage('library:data', next);
  if (sync) queueEdited(previous.queue, next.queue);
  window.dispatchEvent(new Event('hibiki:library-change'));
  return saved;
}
export function addQueueLink(url: string, title: string) {
  return saveLibrary(
    enqueue(loadLibrary(), {
      id: crypto.randomUUID(),
      url,
      title: title.trim() || 'Queued video',
      addedAt: new Date().toISOString(),
    }),
  );
}
export function importDeviceQueue() {
  if (!storageAccount()) return 0;
  const anonymous = validateLibrary(readDeviceStorage('library:data', emptyLibrary()));
  const current = loadLibrary();
  const additions = anonymous.queue.filter((q) => !current.queue.some((p) => p.url === q.url));
  if (current.queue.length + additions.length > 40)
    throw new Error(
      'Your combined queue has more than 40 links. Remove some before importing device saves.',
    );
  saveLibrary({ ...current, queue: [...current.queue, ...additions] });
  return additions.length;
}
export function pinLesson(id: string, pinned: boolean) {
  const state = loadLibrary();
  if (pinned && !state.pinned.includes(id) && state.pinned.length >= 60)
    throw new Error('Your library has 60 saved lessons. Remove one before saving another.');
  return saveLibrary({
    ...state,
    pinned: pinned
      ? [...new Set([...state.pinned, id])]
      : state.pinned.filter((item) => item !== id),
  });
}

/** References only; existing transcript storage and account visibility remain authoritative. */
export function libraryLessons(): StudyRecord[] {
  const recent = recentLessons();
  const history = loadLearnerHistory();
  const references = [
    ...history.sessions.map((s) => ({ id: s.lesson.lessonId, updatedAt: Date.parse(s.updatedAt) })),
    ...history.archives.map((a) => ({
      id: a.lesson.lessonId,
      updatedAt: Date.parse(a.activity.updatedAt),
    })),
    ...accountLessons().map((l) => ({ id: l.lesson.lessonId, updatedAt: Date.parse(l.updatedAt) })),
    ...loadLibrary().pinned.map((id) => ({ id, updatedAt: 0 })),
  ];
  const records = new Map(recent.map((item) => [item.lesson.id, item]));
  for (const reference of references.sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (records.has(reference.id)) continue;
    const lesson = loadLesson(reference.id);
    if (lesson)
      records.set(lesson.id, {
        lesson,
        index: Math.max(
          0,
          Math.min(lesson.segments.length - 1, readStorage<number>(`position:${lesson.id}`, 0)),
        ),
        updatedAt: reference.updatedAt,
      });
  }
  return [...records.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60);
}
