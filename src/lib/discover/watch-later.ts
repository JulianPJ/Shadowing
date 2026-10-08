import { QUEUE_LIMIT, type QueueItem } from '../library/model';
import { canonicalUrl, validVideoId, type Database } from './types';
export type WatchRecord = {
  videoId: string;
  title: string;
  position: number;
  addedAt: string;
  updatedAt: string;
  removed: boolean;
};
export function validateWatchRecord(value: unknown, now = Date.now()): WatchRecord {
  const raw = value as WatchRecord;
  if (
    !raw ||
    !validVideoId(raw.videoId) ||
    typeof raw.title !== 'string' ||
    raw.title.length > 160 ||
    typeof raw.position !== 'number' ||
    !Number.isFinite(raw.position) ||
    Math.abs(raw.position) > 1e15 ||
    !Number.isFinite(Date.parse(raw.addedAt)) ||
    !Number.isFinite(Date.parse(raw.updatedAt)) ||
    Date.parse(raw.updatedAt) > now + 300000 ||
    typeof raw.removed !== 'boolean'
  )
    throw new Error('Invalid watch later record');
  return {
    videoId: raw.videoId,
    title: raw.title,
    position: raw.position,
    addedAt: new Date(raw.addedAt).toISOString(),
    updatedAt: new Date(raw.updatedAt).toISOString(),
    removed: raw.removed,
  };
}
export function mergeWatchRecords(...groups: WatchRecord[][]): WatchRecord[] {
  const byId = new Map<string, WatchRecord>();
  for (const record of groups.flat()) {
    const previous = byId.get(record.videoId);
    // Last update wins. Deletion wins an exact-time tie; remaining ties are deterministic.
    if (
      !previous ||
      record.updatedAt > previous.updatedAt ||
      (record.updatedAt === previous.updatedAt &&
        (Number(record.removed) > Number(previous.removed) ||
          (record.removed === previous.removed &&
            (record.title > previous.title ||
              (record.title === previous.title && record.position > previous.position)))))
    )
      byId.set(record.videoId, record);
  }
  return [...byId.values()].sort(
    (a, b) =>
      a.position - b.position ||
      a.addedAt.localeCompare(b.addedAt) ||
      a.videoId.localeCompare(b.videoId),
  );
}
export function queueFromRecords(records: WatchRecord[]): QueueItem[] {
  return records
    .filter((r) => !r.removed)
    .slice(0, QUEUE_LIMIT)
    .map((r) => ({
      id: `youtube-${r.videoId}`,
      url: canonicalUrl(r.videoId),
      title: r.title,
      addedAt: r.addedAt,
    }));
}
export async function readWatchLater(db: Database, userId: string): Promise<WatchRecord[]> {
  const rows = await db
    .prepare('SELECT * FROM user_watch_later WHERE user_id=? ORDER BY position,added_at,video_id')
    .bind(userId)
    .all<Record<string, unknown>>();
  return rows.results.map((r) =>
    validateWatchRecord({
      videoId: r.video_id,
      title: r.title,
      position: r.position,
      addedAt: r.added_at,
      updatedAt: r.updated_at,
      removed: !!r.removed,
    }),
  );
}
export async function writeWatchLater(db: Database, userId: string, records: WatchRecord[]) {
  if (records.length > 120) throw new Error('Invalid queue batch');
  const existing = new Set((await readWatchLater(db, userId)).map((r) => r.videoId));
  records = records.filter((r) => !r.removed || existing.has(r.videoId));
  if (!records.length) return;
  records = [...records].sort((a, b) => Number(b.removed) - Number(a.removed));
  await db.batch(
    records.map((r) =>
      db
        .prepare(
          `INSERT INTO user_watch_later(user_id,video_id,canonical_url,title,position,added_at,updated_at,removed)
    SELECT ?,?,?,?,?,?,?,? WHERE ?=1 OR (SELECT COUNT(*) FROM user_watch_later WHERE user_id=? AND removed=0)<40 OR EXISTS(SELECT 1 FROM user_watch_later WHERE user_id=? AND video_id=? AND removed=0)
    ON CONFLICT(user_id,video_id) DO UPDATE SET title=excluded.title,position=excluded.position,updated_at=excluded.updated_at,removed=excluded.removed
    WHERE excluded.updated_at>user_watch_later.updated_at OR (excluded.updated_at=user_watch_later.updated_at AND
      (excluded.removed>user_watch_later.removed OR (excluded.removed=user_watch_later.removed AND (excluded.title>user_watch_later.title OR (excluded.title=user_watch_later.title AND excluded.position>user_watch_later.position)))))`,
        )
        .bind(
          userId,
          r.videoId,
          canonicalUrl(r.videoId),
          r.title,
          r.position,
          r.addedAt,
          r.updatedAt,
          Number(r.removed),
          Number(r.removed),
          userId,
          userId,
          r.videoId,
        ),
    ),
  );
  const current = await readWatchLater(db, userId);
  if (
    records.some(
      (r) =>
        !r.removed &&
        !current.some((p) => p.videoId === r.videoId && (!p.removed || p.updatedAt >= r.updatedAt)),
    )
  )
    throw Object.assign(new Error('Watch Later has 40 links. Remove one before syncing another.'), {
      status: 409,
    });
}
