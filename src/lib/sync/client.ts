'use client';
import {
  readStorage,
  writeStorage,
  storageAccount,
  setStorageAccount,
  storageKeys,
} from '../storage/browser';
import { migrateLearnerHistory } from '../learner/migration';
import {
  emptySync,
  syncCollections,
  type AccountUser,
  type SyncData,
  type SyncPage,
} from './types';
import { mergeSync } from './merge';
import { deviceSnapshot } from './snapshot';
import { hydrateSync } from './hydrate';
import { loadLesson } from '../storage/lessons';
import type { Lesson } from '../types';
import { sanitizeDeviceData } from './sanitize';

export type SyncStatus = {
  user: AccountUser | null;
  state: 'local' | 'syncing' | 'saved' | 'offline';
  lastSync: string | null;
  importPending: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
};
let status: SyncStatus = {
  user: null,
  state: 'local',
  lastSync: null,
  importPending: false,
  googleEnabled: false,
  emailEnabled: false,
};
const listeners = new Set<() => void>();
let applying = false,
  running = false,
  rerun = false,
  initialized = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
export const syncStatus = () => status;
export const subscribeSync = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
function publish(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  for (const listener of listeners) listener();
}
async function transport(path: string, body?: unknown) {
  const response = await fetch(path, {
    method: body ? 'POST' : 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(path.startsWith('/api/sync/') && status.user
        ? { 'X-Hibiki-Account': status.user.id }
        : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(response.status === 401 ? 'Signed out' : 'Sync unavailable');
  return response;
}
function cache(): SyncData {
  return sanitizeDeviceData(readStorage('sync:data', emptySync()));
}
function saveCache(data: SyncData) {
  writeStorage('sync:data', data);
}
function hasData(data: SyncData) {
  return !!data.preferences || syncCollections.some((k) => data[k].length > 0);
}
export function scheduleSync() {
  if (!status.user || applying) return;
  publish({ state: 'syncing' });
  clearTimeout(timer);
  timer = setTimeout(() => void synchronize(), 1500);
}

export async function refreshAccount() {
  const ticket = ++generation;
  try {
    const response = await transport('/api/account/me');
    const info = (await response.json()) as {
      user: AccountUser | null;
      googleEnabled: boolean;
      emailEnabled: boolean;
    };
    if (ticket !== generation) return;
    if (info.user?.id !== storageAccount()) {
      // Freeze anonymous eligibility before switching. Declined data remains in its own namespace.
      let anonymous: SyncData | null = null;
      if (!storageAccount() && info.user) {
        await migrateLearnerHistory();
        anonymous = await deviceSnapshot();
      }
      if (ticket !== generation) return;
      applying = true;
      setStorageAccount(info.user?.id ?? null);
      if (
        info.user &&
        anonymous &&
        !readStorage('sync:import-decision', null) &&
        hasData(anonymous)
      )
        writeStorage('sync:import-candidate', anonymous);
      applying = false;
    }
    const saved = readStorage<string | null>('sync:last', null);
    publish({
      user: info.user,
      googleEnabled: info.googleEnabled,
      emailEnabled: info.emailEnabled,
      lastSync: saved,
      state: info.user ? 'syncing' : 'local',
      importPending:
        !!info.user &&
        !!readStorage('sync:import-candidate', null) &&
        !readStorage('sync:import-decision', null),
    });
    if (info.user) await synchronize();
    else window.dispatchEvent(new Event('hibiki:sync-hydrated'));
  } catch {
    publish({ state: status.user ? 'offline' : 'local' });
  }
}

export async function chooseImport(accept: boolean) {
  if (!status.user) return;
  if (accept) {
    const candidate = readStorage<SyncData | null>('sync:import-candidate', null);
    if (candidate) saveCache(mergeSync(cache(), candidate));
    writeStorage('sync:import-decision', 'accepted');
    applying = true;
    try {
      await hydrateSync(cache());
    } finally {
      applying = false;
    }
  } else writeStorage('sync:import-decision', 'declined');
  publish({ importPending: false });
  if (accept) await synchronize();
}

export async function synchronize() {
  if (!status.user) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  const owner = status.user.id,
    ticket = generation;
  try {
    publish({ state: 'syncing' });
    let data = mergeSync(cache(), await deviceSnapshot());
    if (storageAccount() !== owner || ticket !== generation) return;
    saveCache(data); // Durable retry state before the first network operation.
    let cursor: string | null = null;
    let remote = emptySync();
    do {
      const page = (await (
        await transport(
          `/api/sync/bootstrap${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
      ).json()) as SyncPage;
      if (storageAccount() !== owner || ticket !== generation) return;
      remote = mergeSync(remote, page.data);
      data = mergeSync(data, page.data);
      cursor = page.nextCursor;
    } while (cursor);
    // Only the account namespace and explicitly accepted anonymous snapshot reach this point.
    for (const kind of syncCollections) {
      const byId = new Map(remote[kind].map((x) => [x.id, x]));
      const changed = data[kind].filter(
        (x) => JSON.stringify(x) !== JSON.stringify(byId.get(x.id)),
      );
      for (let offset = 0; offset < changed.length; offset += 20) {
        const batch = emptySync();
        Object.assign(batch, { [kind]: changed.slice(offset, offset + 20) });
        if (storageAccount() !== owner || ticket !== generation) return;
        await transport('/api/sync/push', batch);
      }
    }
    if (data.preferences && JSON.stringify(data.preferences) !== JSON.stringify(remote.preferences))
      await transport('/api/sync/push', { ...emptySync(), preferences: data.preferences });
    if (storageAccount() !== owner || ticket !== generation) return;
    // Include edits made while the request was in flight before applying any remote state.
    data = mergeSync(data, await deviceSnapshot());
    // Read server-normalized scores and conflict results after pushing.
    cursor = null;
    do {
      const page = (await (
        await transport(
          `/api/sync/bootstrap${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
      ).json()) as SyncPage;
      if (storageAccount() !== owner || ticket !== generation) return;
      data = mergeSync(data, page.data);
      cursor = page.nextCursor;
    } while (cursor);
    const latest = await deviceSnapshot();
    // In-flight local edits with a newer date survive; equal-date server quiz scoring is authoritative.
    for (const kind of syncCollections) {
      const current = new Map(data[kind].map((x) => [x.id, x]));
      Object.assign(latest, {
        [kind]: latest[kind].filter((x) => {
          const old = current.get(x.id);
          if (!old) return true;
          return (
            ('generatedAt' in x ? x.generatedAt : x.updatedAt) >
            ('generatedAt' in old ? old.generatedAt : old.updatedAt)
          );
        }),
      });
    }
    data = mergeSync(data, latest);
    saveCache(data);
    applying = true;
    try {
      await hydrateSync(data);
    } finally {
      applying = false;
    }
    const lastSync = new Date().toISOString();
    writeStorage('sync:last', lastSync);
    if (readStorage('sync:import-decision', null) === 'accepted')
      writeStorage('sync:import-complete', true);
    publish({ state: 'saved', lastSync });
  } catch {
    if (storageAccount() === owner) publish({ state: 'offline' });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleSync();
    }
  }
}

function localChange(event: Event) {
  if (applying) return;
  const { key, previous, value } = (
    event as CustomEvent<{ key: string; previous: unknown; value: unknown }>
  ).detail;
  if (
    key.startsWith('sync:') ||
    !/^(preferences$|history$|position:|favorites:|completion:|learner-history$|quiz-attempts$)/.test(
      key,
    )
  )
    return;
  const now = new Date().toISOString();
  if (key === 'preferences') writeStorage('sync:preferences-date', now);
  if (key.startsWith('position:') || key.startsWith('completion:'))
    writeStorage(`sync:lesson-date:${key.slice(key.indexOf(':') + 1)}`, now);
  if (key.startsWith('favorites:')) {
    const id = key.slice(10),
      before = Array.isArray(previous) ? previous : [],
      after = Array.isArray(value) ? value : [],
      dates = readStorage<Record<string, { updatedAt: string; deleted: boolean }>>(
        `sync:bookmark-dates:${id}`,
        {},
      );
    for (const sectionId of new Set([...before, ...after]))
      if (typeof sectionId === 'string' && before.includes(sectionId) !== after.includes(sectionId))
        dates[sectionId] = { updatedAt: now, deleted: !after.includes(sectionId) };
    writeStorage(`sync:bookmark-dates:${id}`, dates);
  }
  if (running) rerun = true;
  scheduleSync();
}
export function startSync() {
  if (initialized) return () => {};
  initialized = true;
  window.addEventListener('hibiki:local-write', localChange);
  const online = () => void refreshAccount();
  const visible = () => {
    if (!document.hidden) void refreshAccount();
  };
  const crossTab = (event: StorageEvent) => {
    if (event.key === 'hibiki:v1:active-account') {
      void refreshAccount();
      return;
    }
    if (
      event.key &&
      event.key.startsWith(`hibiki:v1:account:${storageAccount()}:`) &&
      !event.key.includes(':sync:')
    )
      scheduleSync();
  };
  window.addEventListener('online', online);
  window.addEventListener('focus', online);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('storage', crossTab);
  const interval = setInterval(() => {
    if (!document.hidden) void refreshAccount();
  }, 60000);
  void refreshAccount();
  return () => {
    initialized = false;
    clearInterval(interval);
    clearTimeout(timer);
    window.removeEventListener('hibiki:local-write', localChange);
    window.removeEventListener('online', online);
    window.removeEventListener('focus', online);
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('storage', crossTab);
  };
}
export function accountBookmarks() {
  return cache().bookmarks.filter((b) => !b.deleted);
}
export function accountLessons() {
  return status.user ? cache().lessons : [];
}
export async function restoreAccountLesson(lessonId: string): Promise<Lesson | null> {
  const owner = storageAccount(),
    local = loadLesson(lessonId);
  if (local || !owner) return local;
  const reference = cache()
    .lessons.filter((l) => l.lesson.lessonId === lessonId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!reference) return null;
  try {
    const body = (await (
      await transport(`/api/sync/lesson?id=${encodeURIComponent(reference.id)}`)
    ).json()) as { lesson: Lesson };
    if (storageAccount() !== owner) return null;
    writeStorage(`lesson:${lessonId}`, body.lesson);
    applying = true;
    try {
      await hydrateSync(cache());
    } finally {
      applying = false;
    }
    return body.lesson;
  } catch {
    return null;
  }
}
export function hasAnonymousData() {
  return storageKeys().some(
    (k) => k === 'learner-history' || k === 'history' || k === 'quiz-attempts',
  );
}
