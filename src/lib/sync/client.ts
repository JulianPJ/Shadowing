'use client';
import {
  readStorage,
  writeStorage,
  storageAccount,
  setStorageAccount,
  storageKeys,
} from '../storage/browser';
import { canUseFeature } from '../access';
import { basicSyncData } from './access';
import { migrateLearnerHistory } from '../learner/migration';
import {
  emptySync,
  syncCollections,
  type AccountUser,
  type SyncCollection,
  type SyncData,
  type SyncPage,
} from './types';
import { mergeSync } from './merge';
import { deviceSnapshot } from './snapshot';
import { hydrateSync } from './hydrate';
import { loadLesson } from '../storage/lessons';
import type { Lesson } from '../types';
import { sanitizeDeviceData } from './sanitize';
import { loadKnowledge, importKnowledgeRecords } from '../knowledge/client';
import type { WordKnowledgeRecord } from '../knowledge/types';
import { reportChannel, setChannelOwner, syncFailure } from './channel-status';

export type SyncStatus = {
  user: AccountUser | null;
  state: 'local' | 'syncing' | 'saved' | 'offline' | 'attention';
  loaded: boolean;
  error: string;
  lastSync: string | null;
  importPending: boolean;
  googleEnabled: boolean;
  emailEnabled: boolean;
};
let status: SyncStatus = {
  user: null,
  state: 'local',
  loaded: false,
  error: '',
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
// Focus, reconnect and the account poll reuse a recent full sync unless local changes are pending.
const LEARNER_FRESH_MS = 5 * 60_000;
let lastSynced: { owner: string; at: number } | null = null;
const fresh = (owner: string) =>
  lastSynced?.owner === owner &&
  Date.now() - lastSynced.at < LEARNER_FRESH_MS &&
  !readStorage('sync:pending', false);
export const syncStatus = () => status;
export const subscribeSync = (callback: () => void) => {
  listeners.add(callback);
  return () => {
    listeners.delete(callback);
  };
};
function publish(patch: Partial<SyncStatus>) {
  status = { ...status, ...patch };
  setChannelOwner(status.user?.id ?? null);
  if (status.user && patch.state) {
    reportChannel(status.user.id, 'learner', {
      state: patch.state === 'attention' ? 'error' : patch.state === 'local' ? 'idle' : patch.state,
      message: status.error,
    });
  }
  for (const listener of listeners) listener();
}
function failed(error: unknown) {
  lastSynced = null;
  const failure = syncFailure(error);
  publish({
    loaded: true,
    state: status.user ? (failure.state === 'offline' ? 'offline' : 'attention') : 'local',
    error: failure.message,
  });
  if (status.user) reportChannel(status.user.id, 'learner', failure);
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
  if (!response.ok)
    throw Object.assign(new Error(response.status === 401 ? 'Signed out' : 'Sync unavailable'), {
      status: response.status,
    });
  return response;
}
function cache(): SyncData {
  return sanitizeDeviceData(readStorage('sync:data', emptySync()));
}
// What this device last saw of the server: a fingerprint per record, and the watermark of its
// next incremental pull. Changed records are found against the fingerprints.
type Stamps = Partial<Record<SyncCollection, Record<string, string>>>;
type RemoteState = {
  mode: 'learning' | 'viewer';
  watermark: string;
  fullAt: number;
  stamps: Stamps;
};
const FULL_PULL_MS = 86_400_000;
function remoteState(): RemoteState | null {
  const state = readStorage<Partial<RemoteState> | null>('sync:remote', null);
  return state &&
    (state.mode === 'learning' || state.mode === 'viewer') &&
    typeof state.watermark === 'string' &&
    typeof state.fullAt === 'number' &&
    state.stamps &&
    typeof state.stamps === 'object'
    ? (state as RemoteState)
    : null;
}
/** Two 32-bit hashes of the JSON text, so a changed record practically never matches. */
function fingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let a = 0x811c9dc5,
    b = text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
    b ^= b >>> 15;
  }
  return `${(a >>> 0).toString(36)}.${(b >>> 0).toString(36)}`;
}
function stamp(stamps: Stamps, data: SyncData) {
  for (const kind of syncCollections)
    for (const item of data[kind]) (stamps[kind] ??= {})[item.id] = fingerprint(item);
}
function describes(stamps: Stamps, data: SyncData) {
  return syncCollections.every((kind) => {
    const ids = new Set(data[kind].map((x) => x.id));
    return Object.keys(stamps[kind] ?? {}).every((id) => ids.has(id));
  });
}
function saveCache(data: SyncData) {
  writeStorage('sync:data', data);
}
function hasData(data: SyncData) {
  return !!data.preferences || syncCollections.some((k) => data[k].length > 0);
}
const EDIT_DELAY_MS = 1500;
// Practice moves the resume position every section; one sync per half minute carries them, and
// hiding the page sends the latest at once.
const POSITION_DELAY_MS = 30_000;
export function scheduleSync(delay = EDIT_DELAY_MS) {
  if (!status.user?.adultConfirmed || applying) return;
  writeStorage('sync:pending', true);
  publish({ state: 'syncing', error: '' });
  // A pending sync already carries a position change; deferring it would starve during practice.
  if (timer !== undefined && delay > EDIT_DELAY_MS) return;
  clearTimeout(timer);
  timer = setTimeout(() => {
    timer = undefined;
    void synchronize();
  }, delay);
}
const syncDelay = (key: string) =>
  key.startsWith('position:') ? POSITION_DELAY_MS : EDIT_DELAY_MS;
function flushPendingSync() {
  if (timer === undefined) return;
  clearTimeout(timer);
  timer = undefined;
  void synchronize();
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
    if (info.user?.plan !== status.user?.plan) lastSynced = null;
    if (info.user?.id !== storageAccount()) {
      lastSynced = null;
      // Freeze anonymous eligibility before switching. Declined data remains in its own namespace.
      let anonymous: SyncData | null = null;
      let anonymousKnowledge: WordKnowledgeRecord[] = [];
      if (!storageAccount() && info.user) {
        await migrateLearnerHistory();
        anonymous = await deviceSnapshot();
        anonymousKnowledge = Object.values(loadKnowledge());
      }
      if (ticket !== generation) return;
      applying = true;
      setStorageAccount(info.user?.id ?? null);
      if (
        info.user &&
        anonymous &&
        !readStorage('sync:import-decision', null) &&
        (hasData(anonymous) || anonymousKnowledge.length)
      ) {
        writeStorage('sync:import-candidate', anonymous);
        writeStorage('sync:knowledge-import-candidate', anonymousKnowledge);
      }
      applying = false;
    }
    const saved = readStorage<string | null>('sync:last', null);
    const syncing = !!info.user?.adultConfirmed;
    const skip = syncing && fresh(info.user!.id);
    publish({
      user: info.user,
      loaded: true,
      error: '',
      googleEnabled: info.googleEnabled,
      emailEnabled: info.emailEnabled,
      lastSync: saved,
      state: syncing ? (skip ? status.state : 'syncing') : 'local',
      importPending:
        canUseFeature(info.user?.plan, 'learning-sync') &&
        !!info.user &&
        !!readStorage('sync:import-candidate', null) &&
        !readStorage('sync:import-decision', null),
    });
    if (syncing) {
      if (!skip) await synchronize();
    } else window.dispatchEvent(new Event('hibiki:sync-hydrated'));
  } catch (error) {
    if (ticket === generation) failed(error);
  }
}

export async function chooseImport(accept: boolean) {
  const owner = status.user?.id,
    ticket = generation;
  const current = () =>
    storageAccount() === owner && status.user?.id === owner && ticket === generation;
  if (!owner || !current()) return;
  if (accept) {
    const candidate = readStorage<SyncData | null>('sync:import-candidate', null);
    if (candidate) saveCache(mergeSync(cache(), candidate));
    importKnowledgeRecords(
      readStorage<WordKnowledgeRecord[]>('sync:knowledge-import-candidate', []),
    );
    writeStorage('sync:import-decision', 'accepted');
    applying = true;
    try {
      await hydrateSync(cache());
    } finally {
      applying = false;
    }
  } else writeStorage('sync:import-decision', 'declined');
  if (!current()) return;
  writeStorage('sync:knowledge-import-candidate', []);
  publish({ importPending: false });
  if (accept) await synchronize();
}

export async function synchronize() {
  if (!status.user?.adultConfirmed) return;
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  const owner = status.user.id,
    ticket = generation;
  try {
    publish({ state: 'syncing', error: '' });
    let data = mergeSync(cache(), await deviceSnapshot());
    if (storageAccount() !== owner || ticket !== generation) return;
    saveCache(data); // Durable retry state before the first network operation.
    const mode = canUseFeature(status.user?.plan, 'learning-sync') ? 'learning' : 'viewer';
    const known = remoteState();
    // A full pull rebuilds the fingerprints daily, after an access change, or when this device's
    // cache no longer holds the records they describe; otherwise only changes are pulled.
    const incremental =
      known &&
      known.mode === mode &&
      Date.now() - known.fullAt < FULL_PULL_MS &&
      describes(known.stamps, data)
        ? known
        : null;
    const since = incremental?.watermark ?? null;
    const stamps: Stamps = incremental ? structuredClone(incremental.stamps) : {};
    let remote = emptySync();
    const pull = async () => {
      let cursor: string | null = null,
        watermark: string | undefined;
      do {
        const query = new URLSearchParams();
        if (cursor) query.set('cursor', cursor);
        if (since) query.set('since', since);
        const search = query.toString();
        const page = (await (
          await transport(`/api/sync/bootstrap${search ? `?${search}` : ''}`)
        ).json()) as SyncPage;
        if (storageAccount() !== owner || ticket !== generation) return null;
        watermark ??= page.serverTime;
        stamp(stamps, page.data);
        remote = mergeSync(remote, page.data);
        data = mergeSync(data, page.data);
        cursor = page.nextCursor;
      } while (cursor);
      return { watermark };
    };
    const pulled = await pull();
    if (!pulled) return;
    // Only the account namespace and explicitly accepted anonymous snapshot reach this point.
    const upload = mode === 'learning' ? data : basicSyncData(data);
    // Stored versions of pushed records; a server that does not return them is read again below.
    let confirmed = emptySync(),
      unconfirmed = false;
    const push = async (batch: SyncData) => {
      const body = (await (await transport('/api/sync/push', batch)).json()) as {
        data?: SyncData;
      };
      if (body.data) {
        stamp(stamps, body.data);
        confirmed = mergeSync(confirmed, body.data);
      } else unconfirmed = true;
    };
    for (const kind of syncCollections) {
      const changed = upload[kind].filter((x) => fingerprint(x) !== stamps[kind]?.[x.id]);
      for (let offset = 0; offset < changed.length; offset += 20) {
        const batch = emptySync();
        Object.assign(batch, { [kind]: changed.slice(offset, offset + 20) });
        if (storageAccount() !== owner || ticket !== generation) return;
        await push(batch);
      }
    }
    if (
      upload.preferences &&
      JSON.stringify(upload.preferences) !== JSON.stringify(remote.preferences)
    )
      await push({ ...emptySync(), preferences: upload.preferences });
    if (storageAccount() !== owner || ticket !== generation) return;
    // Include edits made while the request was in flight before applying any remote state.
    data = mergeSync(data, await deviceSnapshot());
    if (storageAccount() !== owner || ticket !== generation) return;
    // Apply server-normalized scores and conflict results after pushing. Without a push the
    // server still holds exactly what the pull returned.
    data = mergeSync(data, confirmed);
    if (unconfirmed && !(await pull())) return;
    const latest = await deviceSnapshot();
    if (storageAccount() !== owner || ticket !== generation) return;
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
      await hydrateSync(data, canUseFeature(status.user?.plan, 'learning-sync'));
    } finally {
      applying = false;
    }
    if (storageAccount() !== owner || ticket !== generation) return;
    const lastSync = new Date().toISOString();
    writeStorage('sync:last', lastSync);
    // A server without a watermark supports only full pulls.
    const next: RemoteState | null = pulled.watermark
      ? { mode, watermark: pulled.watermark, fullAt: incremental?.fullAt ?? Date.now(), stamps }
      : null;
    writeStorage('sync:remote', next);
    lastSynced = { owner, at: Date.now() };
    if (!rerun) writeStorage('sync:pending', false);
    if (readStorage('sync:import-decision', null) === 'accepted')
      writeStorage('sync:import-complete', true);
    publish({ state: rerun ? 'syncing' : 'saved', lastSync, error: '' });
  } catch (error) {
    if (storageAccount() === owner && ticket === generation) failed(error);
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      scheduleSync();
    }
  }
}

// Only these keys hold records that learner sync uploads.
const LEARNER_KEY =
  /^(preferences$|history$|position:|favorites:|completion:|learner-history$|quiz-attempts$)/;
function localChange(event: Event) {
  if (applying) return;
  const { key, previous, value } = (
    event as CustomEvent<{ key: string; previous: unknown; value: unknown }>
  ).detail;
  if (key.startsWith('sync:') || !LEARNER_KEY.test(key)) return;
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
  scheduleSync(syncDelay(key));
}
export function startSync() {
  if (initialized) return () => {};
  initialized = true;
  window.addEventListener('hibiki:local-write', localChange);
  const online = () => void refreshAccount();
  const visible = () => {
    if (document.hidden) flushPendingSync();
    else void refreshAccount();
  };
  const crossTab = (event: StorageEvent) => {
    if (event.key === 'hibiki:v1:active-account') {
      void refreshAccount();
      return;
    }
    // Another tab's learner edit is synced here too in case that tab closes first. Other account
    // keys (Discover's seen list, review, caches) must not start a learner sync: hydrating writes
    // in this tab would otherwise wake the other tab, and the two tabs would sync each other forever.
    const prefix = `hibiki:v1:account:${storageAccount()}:`;
    const key = event.key?.startsWith(prefix) ? event.key.slice(prefix.length) : null;
    if (key && LEARNER_KEY.test(key)) scheduleSync(syncDelay(key));
  };
  window.addEventListener('online', online);
  window.addEventListener('focus', online);
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('storage', crossTab);
  // A shorter poll would only re-check the session: syncs within the window are reused anyway.
  const interval = setInterval(() => {
    if (!document.hidden) void refreshAccount();
  }, LEARNER_FRESH_MS);
  void refreshAccount();
  return () => {
    initialized = false;
    clearInterval(interval);
    clearTimeout(timer);
    timer = undefined;
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
