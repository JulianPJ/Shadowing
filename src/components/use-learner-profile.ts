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
            const next = aggregateProfile(
              history,
              loadQuizHistory(),
              bookmarks,
              new Date().toISOString(),
            );
            if (active) {
              setProfile(next);
              setAvailable(
                bookmarks
                  .filter((b) => !!availableLesson(b.lesson.lessonId))
                  .map((b) => identityKey(b.lesson)),
              );
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
    return () => {
      active = false;
      window.removeEventListener('storage', change);
    };
  }, []);
  return { profile, available, warning };
}
