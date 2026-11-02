import {
  emptySync,
  syncCollections,
  type SyncCollection,
  type UserProgressRepository,
} from './types';
import { validateSync } from './validation';
import { validateReviewLimits } from '../review/limits';
export interface ProgressStatement {
  bind(...values: (string | number | null)[]): ProgressStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface ProgressDatabase {
  prepare(sql: string): ProgressStatement;
  batch(statements: ProgressStatement[]): Promise<unknown[]>;
}
const tables: Record<SyncCollection, string> = {
  lessons: 'user_lessons',
  sessions: 'user_practice_sessions',
  attempts: 'user_quiz_attempts',
  bookmarks: 'user_bookmarks',
  difficulties: 'user_difficulty_refs',
  archives: 'user_practice_archives',
};
/**
 * The last ID read from each unfinished collection; no cursor starts every collection. The older
 * `[collection index, last ID]` form, from a tab paginating across a deploy, resumes that
 * collection and reads the later ones from their start.
 */
function parseCursor(cursor?: string | null): Partial<Record<SyncCollection, string>> {
  if (!cursor) return Object.fromEntries(syncCollections.map((kind) => [kind, '']));
  const parsed: unknown = JSON.parse(cursor);
  const validId = (id: unknown): id is string => typeof id === 'string' && id.length <= 1000;
  if (Array.isArray(parsed)) {
    const [index, last] = parsed;
    if (
      parsed.length !== 2 ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= syncCollections.length ||
      !validId(last)
    )
      throw new Error('Invalid cursor');
    return Object.fromEntries(
      syncCollections.slice(index).map((kind, i) => [kind, i === 0 ? last : '']),
    );
  }
  const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
  if (
    !entries.length ||
    entries.some(
      ([kind, id]) => !(syncCollections as readonly string[]).includes(kind) || !validId(id),
    )
  )
    throw new Error('Invalid cursor');
  return Object.fromEntries(entries);
}
function preferences(row: Record<string, unknown> | undefined, viewerOnly = false) {
  if (!row) return null;
  return {
    schemaVersion: 1 as const,
    mode: row.mode as 'shadowing' | 'continuous',
    speed: row.speed as number,
    studioMode: row.studio_mode === 1,
    furigana: row.furigana === 1,
    ...(!viewerOnly && typeof row.review_limits_json === 'string'
      ? { reviewLimits: validateReviewLimits(JSON.parse(row.review_limits_json)) }
      : {}),
    updatedAt: row.updated_at as string,
  };
}
// Worker clocks can differ slightly between requests; re-reading a minute of writes is harmless
// because merges are idempotent.
const CLOCK_OVERLAP_MS = 60_000;
/** The last (synced_at, ID) read from each unfinished collection of a pull since a watermark. */
function parseChangeCursor(
  cursor: string | null | undefined,
  since: string,
): Partial<Record<SyncCollection, [string, string]>> {
  const time = Date.parse(since);
  if (since.length > 40 || !Number.isFinite(time)) throw new Error('Invalid cursor');
  if (!cursor) {
    const start = new Date(time - CLOCK_OVERLAP_MS).toISOString();
    return Object.fromEntries(syncCollections.map((kind) => [kind, [start, '']]));
  }
  const parsed: unknown = JSON.parse(cursor);
  const entries = parsed && typeof parsed === 'object' ? Object.entries(parsed) : [];
  if (
    !entries.length ||
    entries.some(
      ([kind, position]) =>
        !(syncCollections as readonly string[]).includes(kind) ||
        !Array.isArray(position) ||
        position.length !== 2 ||
        typeof position[0] !== 'string' ||
        position[0].length > 40 ||
        typeof position[1] !== 'string' ||
        position[1].length > 1000,
    )
  )
    throw new Error('Invalid cursor');
  return Object.fromEntries(entries) as Partial<Record<SyncCollection, [string, string]>>;
}
export function createD1UserProgressRepository(db: ProgressDatabase): UserProgressRepository {
  return {
    async lesson(userId, id) {
      const row = await db
        .prepare('SELECT payload_json FROM user_lessons WHERE user_id=? AND id=?')
        .bind(userId, id)
        .first<{ payload_json: string }>();
      return row ? JSON.parse(row.payload_json) : null;
    },
    // One page holds up to 50 records of every unfinished collection, read in one D1 round trip,
    // so a typical pull is a single request (and session check) rather than one per collection.
    // A full pull pages by ID; a pull `since` a watermark pages by (synced_at, ID).
    async bootstrap(userId, cursor, viewerOnly = false, since = null) {
      // Taken before reading, so a write that lands during this pull is in the next one.
      const serverTime = new Date().toISOString();
      const pending = since ? parseChangeCursor(cursor, since) : parseCursor(cursor);
      const kinds = syncCollections.filter(
        (kind) => pending[kind] !== undefined && (!viewerOnly || kind === 'lessons'),
      );
      const [prefsResult, ...pages] = (await db.batch([
        db.prepare('SELECT * FROM user_preferences WHERE user_id=?').bind(userId),
        // Composite keys supply the user-scoped keyset indexes, never OFFSET.
        ...kinds.map((kind) => {
          const position = pending[kind]!;
          return Array.isArray(position)
            ? db
                .prepare(
                  `SELECT id,payload_json,synced_at FROM ${tables[kind]} WHERE user_id=? AND (synced_at,id)>(?,?) ORDER BY synced_at,id LIMIT 51`,
                )
                .bind(userId, position[0], position[1])
            : db
                .prepare(
                  `SELECT id,payload_json FROM ${tables[kind]} WHERE user_id=? AND id>? ORDER BY id LIMIT 51`,
                )
                .bind(userId, position);
        }),
      ])) as { results: Record<string, unknown>[] }[];
      const data = emptySync();
      const next: Partial<Record<SyncCollection, string | [string, string]>> = {};
      kinds.forEach((kind, i) => {
        const rows = pages[i].results as { id: string; payload_json: string; synced_at?: string }[];
        const page = rows.slice(0, 50);
        Object.assign(data, { [kind]: page.map((r) => JSON.parse(r.payload_json)) });
        const last = page.at(-1)!;
        if (rows.length > 50) next[kind] = since ? [last.synced_at!, last.id] : last.id;
      });
      data.preferences = preferences(prefsResult.results[0], viewerOnly);
      return {
        data,
        nextCursor: Object.keys(next).length ? JSON.stringify(next) : null,
        serverTime,
      };
    },
    async push(userId, input) {
      const data = validateSync(input);
      // Validate immutable identity before any writes. Ownership always comes from session.
      for (const kind of syncCollections) {
        for (const item of data[kind]) {
          const lesson =
            'lesson' in item ? item.lesson : 'archive' in item ? item.archive.lesson : item;
          const old = await db
            .prepare(
              `SELECT lesson_id,transcript_key FROM ${tables[kind]} WHERE user_id=? AND id=?`,
            )
            .bind(userId, item.id)
            .first<{ lesson_id: string; transcript_key: string }>();
          if (
            old &&
            (old.lesson_id !== lesson.lessonId || old.transcript_key !== lesson.transcriptKey)
          )
            throw new Error('Immutable record identity changed');
        }
      }
      const statements: ReturnType<ProgressDatabase['prepare']>[] = [];
      if (data.preferences) {
        const p = data.preferences;
        statements.push(
          db
            .prepare(
              `INSERT INTO user_preferences(user_id,schema_version,mode,speed,studio_mode,furigana,review_limits_json,updated_at) VALUES (?,1,?,?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,speed=excluded.speed,studio_mode=excluded.studio_mode,furigana=excluded.furigana,review_limits_json=COALESCE(excluded.review_limits_json,user_preferences.review_limits_json),updated_at=excluded.updated_at WHERE excluded.updated_at>user_preferences.updated_at`,
            )
            .bind(
              userId,
              p.mode,
              p.speed,
              +p.studioMode,
              +p.furigana,
              p.reviewLimits === undefined ? null : JSON.stringify(p.reviewLimits),
              p.updatedAt,
            ),
        );
      }
      // Every accepted write is stamped for incremental pulls; a rejected stale write keeps its stamp.
      const syncedAt = new Date().toISOString();
      for (const kind of syncCollections)
        for (const item of data[kind]) {
          const lesson =
            'lesson' in item ? item.lesson : 'archive' in item ? item.archive.lesson : item;
          const updated = 'generatedAt' in item ? item.generatedAt : item.updatedAt,
            table = tables[kind];
          const payload = JSON.stringify(item);
          let conflict = `DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json,synced_at=excluded.synced_at WHERE excluded.updated_at>${table}.updated_at AND ${table}.lesson_id=excluded.lesson_id AND ${table}.transcript_key=excluded.transcript_key`;
          if (kind === 'archives') conflict = 'DO NOTHING';
          if (kind === 'bookmarks')
            conflict = `DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json,synced_at=excluded.synced_at WHERE excluded.updated_at>${table}.updated_at OR (excluded.updated_at=${table}.updated_at AND json_extract(excluded.payload_json,'$.deleted')=1)`;
          if (kind === 'lessons')
            conflict = `DO UPDATE SET
          synced_at=excluded.synced_at,
          updated_at=MAX(updated_at,excluded.updated_at),
          payload_json=json_set(CASE WHEN excluded.updated_at>${table}.updated_at THEN excluded.payload_json ELSE ${table}.payload_json END,
          '$.completed',json(CASE WHEN json_extract(${table}.payload_json,'$.completed') OR json_extract(excluded.payload_json,'$.completed') THEN 'true' ELSE 'false' END),
          '$.completedAt',CASE WHEN json_extract(${table}.payload_json,'$.completedAt') IS NULL THEN json_extract(excluded.payload_json,'$.completedAt') WHEN json_extract(excluded.payload_json,'$.completedAt') IS NULL THEN json_extract(${table}.payload_json,'$.completedAt') ELSE MAX(json_extract(${table}.payload_json,'$.completedAt'),json_extract(excluded.payload_json,'$.completedAt')) END)`;
          statements.push(
            db
              .prepare(
                `INSERT INTO ${table}(user_id,id,lesson_id,transcript_key,updated_at,payload_json,synced_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id,id) ${conflict}`,
              )
              .bind(
                userId,
                item.id,
                lesson.lessonId,
                lesson.transcriptKey,
                updated,
                payload,
                syncedAt,
              ),
          );
        }
      // D1 batches are atomic; the client sends bounded batches and retries idempotently.
      if (statements.length) await db.batch(statements);
      // Read back what was stored (merged lessons, newer server records), replacing the device's
      // second full pull. D1 binds at most 100 parameters per statement.
      const reads: { kind: SyncCollection; statement: ProgressStatement }[] = [];
      for (const kind of syncCollections) {
        const ids = data[kind].map((item) => item.id);
        for (let i = 0; i < ids.length; i += 90) {
          const chunk = ids.slice(i, i + 90);
          reads.push({
            kind,
            statement: db
              .prepare(
                `SELECT payload_json FROM ${tables[kind]} WHERE user_id=? AND id IN (${chunk.map(() => '?').join(',')})`,
              )
              .bind(userId, ...chunk),
          });
        }
      }
      const lookups = reads.map((r) => r.statement);
      if (data.preferences)
        lookups.push(db.prepare('SELECT * FROM user_preferences WHERE user_id=?').bind(userId));
      const results = lookups.length
        ? ((await db.batch(lookups)) as { results: Record<string, unknown>[] }[])
        : [];
      const stored = emptySync();
      reads.forEach(({ kind }, i) =>
        (stored[kind] as unknown[]).push(
          ...results[i].results.map((r) => JSON.parse(String(r.payload_json))),
        ),
      );
      if (data.preferences) stored.preferences = preferences(results[reads.length].results[0]);
      return stored;
    },
  };
}
