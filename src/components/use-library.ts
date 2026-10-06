'use client';
import { useEffect, useState } from 'react';
import { libraryLessons, loadLibrary } from '@/lib/library/client';
import { emptyLibrary, type LibraryState } from '@/lib/library/model';
import type { StudyRecord } from '@/lib/storage/lessons';
import { accountLessons } from '@/lib/sync/client';
import type { SyncedLesson } from '@/lib/sync/types';
export function useLibrary() {
  const [state, setState] = useState<LibraryState>(emptyLibrary);
  const [lessons, setLessons] = useState<StudyRecord[]>([]);
  const [remote, setRemote] = useState<SyncedLesson[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const refresh = () => {
      setState(loadLibrary());
      setLessons(libraryLessons());
      setRemote(accountLessons());
      setReady(true);
    };
    refresh();
    const events = [
      'hibiki:library-change',
      'hibiki:sync-hydrated',
      'hibiki:account-change',
      'storage',
    ];
    for (const event of events) window.addEventListener(event, refresh);
    return () => {
      for (const event of events) window.removeEventListener(event, refresh);
    };
  }, []);
  return { state, lessons, remote, ready };
}
