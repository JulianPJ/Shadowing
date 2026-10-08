'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus, subscribeSync, accountLessons } from '../sync/client';
import { reportChannel, syncFailure } from '../sync/channel-status';
import { loadLibrary, saveLibrary } from '../library/client';
import { normalizeQueueUrl, type QueueItem } from '../library/model';
import { parseYouTubeUrl } from '../youtube';
import {
  DEFAULT_PREFERENCES,
  EMPTY_CONTEXT,
  bandFromRange,
  type Preferences,
  type Context,
} from './types';
import { validatePreferences } from './validation';
import {
  mergeWatchRecords,
  queueFromRecords,
  validateWatchRecord,
  type WatchRecord,
} from './watch-later';
import type { LearnerProfile } from '../learner-types';
type Feedback = {
  videoId: string;
  action: 'not_interested' | 'more_like_this' | 'reset';
  createdAt: string;
};
export function discoveryPreferences() {
  try {
    return validatePreferences(readStorage('discover:preferences', DEFAULT_PREFERENCES));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}
export function saveDiscoveryPreferences(preferences: Preferences) {
  const saved = writeStorage('discover:preferences', validatePreferences(preferences));
  if (storageAccount()) writeStorage('discover:preferences-pending', true);
  publish('preferences');
  void syncDiscover();
  return saved;
}
function watchRecords() {
  return readStorage<WatchRecord[]>('library:watch-records', []).flatMap((r) => {
    try {
      return [validateWatchRecord(r)];
    } catch {
      return [];
    }
  });
}
function outbox() {
  return readStorage<WatchRecord[]>('library:watch-outbox', []);
}
/** Called by the library facade on deliberate queue edits, never during hydration. */
export function queueEdited(previous: QueueItem[], next: QueueItem[]) {
  if (!storageAccount()) return;
  const records = watchRecords(),
    updates: WatchRecord[] = [];
  const time = new Date(
    Math.max(Date.now(), ...records.map((r) => Date.parse(r.updatedAt) + 1)),
  ).toISOString();
  const ids = (items: QueueItem[]) =>
    items.flatMap((q) => {
      try {
        return [{ id: parseYouTubeUrl(q.url), item: q }];
      } catch {
        return [];
      }
    });
  const before = ids(previous),
    after = ids(next);
  for (const { id, item } of after) {
    const index = after.findIndex((q) => q.id === id),
      old = records.find((r) => r.videoId === id);
    const oldIndex = before.findIndex((q) => q.id === id);
    if (!old || old.removed || oldIndex !== index || old.title !== item.title)
      updates.push({
        videoId: id,
        title: item.title,
        position: index,
        addedAt: old?.addedAt ?? item.addedAt,
        updatedAt: time,
        removed: false,
      });
  }
  for (const { id, item } of before)
    if (!after.some((q) => q.id === id)) {
      const old = records.find((r) => r.videoId === id);
      updates.push({
        videoId: id,
        title: item.title,
        position: old?.position ?? 0,
        addedAt: old?.addedAt ?? item.addedAt,
        updatedAt: time,
        removed: true,
      });
    }
  if (!updates.length) return;
  writeStorage('library:watch-records', mergeWatchRecords(records, updates));
  writeStorage('library:watch-outbox', mergeWatchRecords(outbox(), updates));
  publish();
  void syncDiscover();
}
export function discoveryFeedback(): Feedback[] {
  return readStorage<Feedback[]>('discover:feedback', [])
    .filter((f) => Date.parse(f.createdAt) > Date.now() - 180 * 86400000)
    .slice(0, 120);
}
export function giveFeedback(videoId: string, action: Feedback['action']) {
  const entry = { videoId, action, createdAt: new Date().toISOString() };
  const saved = writeStorage(
    'discover:feedback',
    [entry, ...discoveryFeedback().filter((f) => f.videoId !== videoId)].slice(0, 120),
  );
  if (storageAccount())
    writeStorage(
      'discover:feedback-outbox',
      [
        entry,
        ...readStorage<Feedback[]>('discover:feedback-outbox', []).filter(
          (f) => f.videoId !== videoId,
        ),
      ].slice(0, 120),
    );
  publish('feedback');
  void syncDiscover();
  return saved;
}
export function rememberSeen(ids: string[]) {
  writeStorage(
    'discover:seen',
    [...new Set([...ids, ...readStorage<string[]>('discover:seen', [])])].slice(0, 120),
  );
}
export function discoveryContext(profile: LearnerProfile | null): Context {
  const prefs = discoveryPreferences();
  const completed = profile?.lessons.filter((l) => l.completed) ?? [];
  const measured = completed.filter((l) => l.difficulty);
  const bands = measured
    .map((l) => bandFromRange(l.difficulty!.jlptMin, l.difficulty!.jlptMax))
    .filter((b) => b !== null);
  const suggestion =
    profile?.typicalContent && bands.length >= 2
      ? bandFromRange(profile.typicalContent.min, profile.typicalContent.max)
      : null;
  const durations = completed
    .map((l) => l.lesson.duration)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const feedback = discoveryFeedback();
  return {
    ...EMPTY_CONTEXT,
    suggestedBand: prefs.preferredBand ?? suggestion,
    preferredTopics: prefs.topics,
    comfortableSeconds: durations.length >= 2 ? durations[Math.floor(durations.length / 2)] : null,
    completed: completed
      .map((l) => l.lesson.videoId)
      .filter((id): id is string => !!id)
      .slice(0, 80),
    saved: loadLibrary().queue.flatMap((q) => {
      try {
        return [parseYouTubeUrl(q.url)];
      } catch {
        return [];
      }
    }),
    seen: readStorage<string[]>('discover:seen', []).slice(0, 120),
    ignored: feedback.filter((f) => f.action === 'not_interested').map((f) => f.videoId),
    liked: feedback.filter((f) => f.action === 'more_like_this').map((f) => f.videoId),
    vocabularyFit: {},
  };
}
export async function recordDiscoveryEvents(
  events: { videoId: string; action: 'impression' | 'open' | 'prepared' | 'complete' | 'save' }[],
) {
  const owner = storageAccount();
  if (!owner || syncStatus().user?.id !== owner || !syncStatus().user?.emailVerified) return;
  try {
    await fetch('/api/discover/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Hibiki-Account': owner },
      body: JSON.stringify({ events: events.slice(0, 24) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    /* Best-effort diagnostics never block practice. */
  }
}
const pendingCount = () =>
  outbox().length +
  Number(readStorage('discover:preferences-pending', false)) +
  readStorage<Feedback[]>('discover:feedback-outbox', []).length;
function publish(kind: 'queue' | 'preferences' | 'feedback' | 'sync' = 'queue') {
  const owner = storageAccount();
  if (owner) reportChannel(owner, 'discovery', { pending: pendingCount() });
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('hibiki:discover-change', { detail: { kind } }));
}
let running = false,
  rerun = false;
export async function syncDiscover() {
  const owner = storageAccount(),
    user = syncStatus().user;
  if (!owner || user?.id !== owner) return;
  if (!user.emailVerified) {
    reportChannel(owner, 'discovery', {
      state: 'auth',
      pending: pendingCount(),
      message: 'Verify your email to sync Watch Later and Discover.',
    });
    return;
  }
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  const current = () => storageAccount() === owner && syncStatus().user?.id === owner;
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'X-Hibiki-Account': owner,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!current()) throw new Error('Account changed');
    if (!response.ok)
      throw Object.assign(new Error('Discover sync unavailable'), { status: response.status });
    const result = await response.json();
    if (!current()) throw new Error('Account changed');
    return result;
  };
  reportChannel(owner, 'discovery', { state: 'syncing', pending: pendingCount(), message: '' });
  try {
    const previousPreferences = JSON.stringify(discoveryPreferences());
    const previousFeedback = JSON.stringify(discoveryFeedback());
    // Migrate only the current account's local queue, once. Anonymous saves require explicit import.
    if (!readStorage('library:watch-initialised', false)) {
      queueEdited([], loadLibrary().queue);
      writeStorage('library:watch-initialised', true);
    }
    const pending = outbox();
    // Replay deletions first so a full remote queue has room for replacement saves.
    const ordered = [...pending].sort((a, b) => Number(b.removed) - Number(a.removed));
    for (let offset = 0; offset < ordered.length; offset += 120) {
      const batch = ordered.slice(offset, offset + 120);
      await request('/api/watch-later', 'POST', { records: batch });
      if (!current()) return;
      writeStorage(
        'library:watch-outbox',
        outbox().filter(
          (r) => !batch.some((p) => p.videoId === r.videoId && p.updatedAt === r.updatedAt),
        ),
      );
    }
    const remote = await request('/api/watch-later');
    if (!current()) return;
    const merged = mergeWatchRecords(
      remote.records.map((r: unknown) => validateWatchRecord(r)),
      outbox(),
    );
    writeStorage('library:watch-records', merged);
    const library = loadLibrary(),
      other = library.queue.filter((q) => {
        try {
          parseYouTubeUrl(q.url);
          return false;
        } catch {
          return true;
        }
      });
    saveLibrary({ ...library, queue: [...queueFromRecords(merged), ...other].slice(0, 40) }, false);
    if (readStorage('discover:preferences-pending', false)) {
      const sent = discoveryPreferences();
      await request('/api/discover/preferences', 'PATCH', sent);
      if (!current()) return;
      if (JSON.stringify(sent) === JSON.stringify(discoveryPreferences()))
        writeStorage('discover:preferences-pending', false);
    } else {
      const data = await request('/api/discover/preferences');
      if (!current()) return;
      if (!readStorage('discover:preferences-pending', false))
        writeStorage('discover:preferences', validatePreferences(data.preferences));
    }
    const feedbackPending = readStorage<Feedback[]>('discover:feedback-outbox', []);
    for (const entry of feedbackPending) {
      await request('/api/discover/feedback', 'POST', entry);
      if (!current()) return;
      writeStorage(
        'discover:feedback-outbox',
        readStorage<Feedback[]>('discover:feedback-outbox', []).filter(
          (f) => !(f.videoId === entry.videoId && f.createdAt === entry.createdAt),
        ),
      );
    }
    const feedback = await request('/api/discover/feedback');
    if (!current()) return;
    const mergedFeedback = new Map<string, Feedback>();
    for (const entry of [
      ...feedback.feedback.map(
        (f: { video_id: string; action: Feedback['action']; created_at: string }) => ({
          videoId: f.video_id,
          action: f.action,
          createdAt: f.created_at,
        }),
      ),
      ...discoveryFeedback(),
    ]) {
      const previous = mergedFeedback.get(entry.videoId);
      if (!previous || entry.createdAt >= previous.createdAt)
        mergedFeedback.set(entry.videoId, entry);
    }
    writeStorage(
      'discover:feedback',
      [...mergedFeedback.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 120),
    );
    publish(
      previousPreferences !== JSON.stringify(discoveryPreferences()) ||
        previousFeedback !== JSON.stringify(discoveryFeedback())
        ? 'sync'
        : 'queue',
    );
    reportChannel(owner, 'discovery', {
      state: pendingCount() ? 'pending' : 'saved',
      pending: pendingCount(),
      lastSync: new Date().toISOString(),
      message: '',
    });
  } catch (error) {
    if (current())
      reportChannel(owner, 'discovery', { ...syncFailure(error), pending: pendingCount() });
  } finally {
    running = false;
    if (rerun) {
      rerun = false;
      void syncDiscover();
    }
  }
}
export function startDiscoverSync() {
  let identity = '';
  const change = () => {
    const next = `${storageAccount()}:${syncStatus().user?.id}:${syncStatus().user?.emailVerified}`;
    if (next !== identity) {
      identity = next;
      void syncDiscover();
    }
  };
  const refresh = () => void syncDiscover();
  const unsubscribe = subscribeSync(change);
  const completions = () => {
    const completed = accountLessons()
      .filter((l) => l.completed)
      .flatMap((l) =>
        l.lesson.videoId ? [{ videoId: l.lesson.videoId, action: 'complete' as const }] : [],
      )
      .slice(0, 24);
    if (completed.length) void recordDiscoveryEvents(completed);
  };
  window.addEventListener('hibiki:sync-hydrated', completions);
  for (const event of ['online', 'focus', 'hibiki:account-change'])
    window.addEventListener(event, refresh);
  change();
  return () => {
    unsubscribe();
    window.removeEventListener('hibiki:sync-hydrated', completions);
    for (const event of ['online', 'focus', 'hibiki:account-change'])
      window.removeEventListener(event, refresh);
  };
}
export function savedVideo(url: string) {
  return loadLibrary().queue.some((q) => q.url === normalizeQueueUrl(url));
}
