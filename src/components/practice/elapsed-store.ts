'use client';
import { useSyncExternalStore } from 'react';

/**
 * Playback time changes several times a second. Keeping it outside React state lets only the
 * section progress bar re-render, instead of the whole player and transcript.
 */
export function createElapsedStore(initial: number) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(next: number) {
      if (next === value) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export type ElapsedStore = ReturnType<typeof createElapsedStore>;

export function useElapsed(store: ElapsedStore) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
