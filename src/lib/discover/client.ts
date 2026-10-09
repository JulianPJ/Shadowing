'use client';
import { readStorage, writeStorage, storageAccount } from '../storage/browser';
import { syncStatus, accountLessons } from '../sync/client';
import { createSyncChannel } from '../sync/channel';
import { loadLibrary, saveLibrary } from '../library/client';
import { normalizeQueueUrl, type QueueItem } from '../library/model';
import { parseYouTubeUrl } from '../youtube';
import {
  DEFAULT_PREFERENCES,
  EMPTY_CONTEXT,
  bandFromRange,
  canonicalUrl,
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
  if (!updates.length) {
    // A freed place can reveal an account save beyond this device's list, which needs a fresh
    // pull even when nothing is queued.
    if (previous.length !== next.length) void discoverSync.sync({ force: true }).catch(() => {});
    return;
  }
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
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent('hibiki:discover-change', { detail: { kind } }));
}
type RemoteFeedback = { video_id: string; action: Feedback['action']; created_at: string };
export const discoverSync = createSyncChannel({
  channel: 'discovery',
  pending: pendingCount,
  async run({ request }) {
    const previousPreferences = JSON.stringify(discoveryPreferences());
    const previousFeedback = JSON.stringify(discoveryFeedback());
    // Migrate only the current account's local queue, once. Anonymous saves require explicit import.
    if (!readStorage('library:watch-initialised', false)) {
      queueEdited([], loadLibrary().queue);
      writeStorage('library:watch-initialised', true);
    }
    // Replay deletions first so a full remote queue has room for replacement saves.
    const ordered = [...outbox()].sort((a, b) => Number(b.removed) - Number(a.removed));
    for (let offset = 0; offset < ordered.length; offset += 120) {
      const batch = ordered.slice(offset, offset + 120);
      await request('/api/watch-later', { body: { records: batch } });
      writeStorage(
        'library:watch-outbox',
        outbox().filter(
          (r) => !batch.some((p) => p.videoId === r.videoId && p.updatedAt === r.updatedAt),
        ),
      );
    }
    const remote = await request<{ records: unknown[] }>('/api/watch-later');
    const merged = mergeWatchRecords(
      remote.records.map((r) => validateWatchRecord(r)),
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
    // Device-only media must survive a full remote queue. Extra account links remain in records/D1.
    saveLibrary({ ...library, queue: [...other, ...queueFromRecords(merged)].slice(0, 40) }, false);
    if (readStorage('discover:preferences-pending', false)) {
      const sent = discoveryPreferences();
      await request('/api/discover/preferences', { method: 'PATCH', body: sent });
      if (JSON.stringify(sent) === JSON.stringify(discoveryPreferences()))
        writeStorage('discover:preferences-pending', false);
    } else {
      const data = await request<{ preferences: unknown }>('/api/discover/preferences');
      if (!readStorage('discover:preferences-pending', false))
        writeStorage('discover:preferences', validatePreferences(data.preferences));
    }
    for (const entry of readStorage<Feedback[]>('discover:feedback-outbox', [])) {
      await request('/api/discover/feedback', { body: entry });
      writeStorage(
        'discover:feedback-outbox',
        readStorage<Feedback[]>('discover:feedback-outbox', []).filter(
          (f) => !(f.videoId === entry.videoId && f.createdAt === entry.createdAt),
        ),
      );
    }
    const feedback = await request<{ feedback: RemoteFeedback[] }>('/api/discover/feedback');
    const mergedFeedback = new Map<string, Feedback>();
    for (const entry of [
      ...feedback.feedback.map((f) => ({
        videoId: f.video_id,
        action: f.action,
        createdAt: f.created_at,
      })),
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
  },
});
/** Pushes Watch Later, preferences and feedback, then pulls them. Failures stay queued. */
export const syncDiscover = () => discoverSync.sync().catch(() => {});
/** Records lesson completions for Discover ranking once learner progress has hydrated. */
export function startDiscoverEvents() {
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
  return () => window.removeEventListener('hibiki:sync-hydrated', completions);
}
export function savedVideo(url: string) {
  return loadLibrary().queue.some((q) => q.url === normalizeQueueUrl(url));
}
export function hiddenAccountSaveCount() {
  const visible = new Set(loadLibrary().queue.map((q) => q.url));
  return watchRecords().filter((r) => !r.removed && !visible.has(canonicalUrl(r.videoId))).length;
}
