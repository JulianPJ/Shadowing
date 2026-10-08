'use client';
import { useEffect, useState } from 'react';
import { aggregateProfile, identityKey } from '@/lib/learner-progress';
import {
  availableLesson,
  currentBookmarks,
  loadQuizHistory,
  migrateLearnerHistory,
} from '@/lib/learner-storage';
import { progressStorageFailed } from '@/lib/storage';
import type { LearnerProfile } from '@/lib/learner-types';
import { accountBookmarks } from '@/lib/sync/client';
import { transcriptKey } from '@/lib/transcript';

export function useLearnerProfile() {
  const [profile, setProfile] = useState<LearnerProfile | null>(null);
  const [available, setAvailable] = useState<string[]>([]);
  const [warning, setWarning] = useState(false);
  useEffect(() => {
    let active = true;
    let refreshing = false;
    let pending = false;
    const refresh = async () => {
      pending = true;
      if (refreshing) return;
      refreshing = true;
      try {
        // Coalesce bursts while retaining one trailing refresh for the latest browser data.
        while (active && pending) {
          pending = false;
          try {
            const history = await migrateLearnerHistory();
            const identities = [
              ...history.sessions.map((s) => s.lesson),
              ...history.archives.map((a) => a.lesson),
            ];
            const bookmarks = await currentBookmarks(identities, history);
            for (const remote of accountBookmarks()) {
              let snapshot = bookmarks.find(
                (b) => identityKey(b.lesson) === identityKey(remote.lesson),
              );
              if (!snapshot) {
                snapshot = { lesson: remote.lesson, sections: [] };
                bookmarks.push(snapshot);
              }
              if (!snapshot.sections.some((s) => s.sectionId === remote.sectionId))
                snapshot.sections.push({
                  sectionId: remote.sectionId,
                  start: remote.start,
                  end: remote.end,
                });
            }
            const next = aggregateProfile(
              history,
              loadQuizHistory(),
              bookmarks,
              new Date().toISOString(),
            );
            const revisions = new Map<string, Promise<string | null>>();
            const availableIdentities = await Promise.all(
              bookmarks.map(async (bookmark) => {
                const id = bookmark.lesson.lessonId;
                if (!revisions.has(id)) {
                  const local = availableLesson(id);
                  revisions.set(id, local ? transcriptKey(local) : Promise.resolve(null));
                }
                return (await revisions.get(id)) === bookmark.lesson.transcriptKey
                  ? identityKey(bookmark.lesson)
                  : null;
              }),
            );
            if (active) {
              setProfile(next);
              setAvailable(availableIdentities.filter((key): key is string => key !== null));
              setWarning(progressStorageFailed());
            }
          } catch {
            if (active) setWarning(true);
          }
        }
      } finally {
        refreshing = false;
      }
    };
    void refresh();
    const change = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith('hibiki:v1:')) void refresh();
    };
    window.addEventListener('storage', change);
    const synced = () => void refresh();
    window.addEventListener('hibiki:sync-hydrated', synced);
    window.addEventListener('hibiki:account-change', synced);
    return () => {
      active = false;
      window.removeEventListener('storage', change);
      window.removeEventListener('hibiki:sync-hydrated', synced);
      window.removeEventListener('hibiki:account-change', synced);
    };
  }, []);
  return { profile, available, warning };
}
