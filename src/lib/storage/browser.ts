export const PREFIX = 'hibiki:v1:';

const unsaved = new Map<string, unknown>();
// This is a cache selector, never authentication proof. Only /account/me enables remote writes.
let account: string | null = (() => {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(localStorage.getItem(PREFIX + 'active-account') ?? 'null');
    return typeof value === 'string' && /^[\w-]{1,200}$/.test(value) ? value : null;
  } catch {
    return null;
  }
})();
export function storageAccount() {
  return account;
}
const owned = (key: string) =>
  /^(preferences$|history$|learner-history$|learner-migration|position:|favorites:|completion:|quiz-attempt|sync:|review:|dictionary:|knowledge:|library:|discover:|report:|goal:|shadowing:|drill:)/.test(
    key,
  );
function physicalKey(key: string) {
  return account && owned(key) ? `account:${account}:${key}` : key;
}
export function setStorageAccount(next: string | null) {
  if (account === next) return;
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hibiki:account-changing'));
  account = next;
  try {
    localStorage.setItem(PREFIX + 'active-account', JSON.stringify(next));
  } catch {
    /* Keep the current visit usable. */
  }
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('hibiki:account-change'));
}

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
  return [...keys].flatMap((key) => {
    if (key.startsWith('account:')) {
      const prefix = `account:${account}:`;
      return account && key.startsWith(prefix) ? [key.slice(prefix.length)] : [];
    }
    return account && owned(key) ? [] : [key];
  });
}

export function readStorage<T>(key: string, fallback: T): T {
  key = physicalKey(key);
  if (unsaved.has(key)) return structuredClone(unsaved.get(key)) as T;
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function persistStorage(key: string, value: unknown, onlyIfChanged: boolean) {
  const logicalKey = key;
  key = physicalKey(key);
  const previous = readStorage(logicalKey, null);
  const changed = JSON.stringify(previous) !== JSON.stringify(value);
  const notify = () => {
    if (changed && typeof window !== 'undefined')
      window.dispatchEvent(
        new CustomEvent('hibiki:local-write', { detail: { key: logicalKey, previous, value } }),
      );
  };
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
    notify();
    return true;
  } catch {
    unsaved.set(key, structuredClone(value));
    reportStorageFailure();
    notify();
    return false; /* Playback still works. */
  }
}

/** Anonymous data can be read for an explicit import without changing the active account. */
export function readDeviceStorage<T>(key: string, fallback: T): T {
  if (unsaved.has(key)) return structuredClone(unsaved.get(key)) as T;
  try {
    const value = localStorage.getItem(PREFIX + key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStorage(key: string, value: unknown) {
  return persistStorage(key, value, false);
}

/** Avoid rewriting an unchanged transcript; retry failed writes on every later save. */
export function writeStorageIfChanged(key: string, value: unknown) {
  return persistStorage(key, value, true);
}
