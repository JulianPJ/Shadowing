export const PREFIX = 'hibiki:v1:';

const unsaved = new Map<string, unknown>();

let storageFailed = false;

export function progressStorageFailed() {
  return storageFailed;
}

export function reportStorageFailure() {
  storageFailed = true;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hibiki:storage-warning'));
}

export function storageKeys(): string[] {
  const keys = new Set<string>(unsaved.keys());
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(PREFIX)) keys.add(key.slice(PREFIX.length));
    }
  } catch {
    reportStorageFailure();
  }
  return [...keys];
}

export function readStorage<T>(key: string, fallback: T): T {
  if (unsaved.has(key)) return structuredClone(unsaved.get(key)) as T;
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistStorage(key: string, value: unknown, onlyIfChanged: boolean) {
  try {
    const serialized = JSON.stringify(value);
    if (onlyIfChanged && !unsaved.has(key)) {
      try {
        if (localStorage.getItem(PREFIX + key) === serialized) return true;
      } catch {
        // Some storage implementations can accept writes despite failing reads.
      }
    }
    localStorage.setItem(PREFIX + key, serialized);
    unsaved.delete(key);
    return true;
  } catch {
    unsaved.set(key, structuredClone(value));
    reportStorageFailure();
    return false; /* Playback still works. */
  }
}

export function writeStorage(key: string, value: unknown) {
  return persistStorage(key, value, false);
}

/** Avoid rewriting an unchanged transcript; retry failed writes on every later save. */
export function writeStorageIfChanged(key: string, value: unknown) {
  return persistStorage(key, value, true);
}
