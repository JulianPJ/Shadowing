import {
  emptySync,
  syncCollections,
  type SyncCollection,
  type UserProgressRepository,
} from './types';
import { validateSync } from './validation';
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
export function createD1UserProgressRepository(db: ProgressDatabase): UserProgressRepository {
  return {
    async lesson(userId, id) {
      const row = await db
        .prepare('SELECT payload_json FROM user_lessons WHERE user_id=? AND id=?')
        .bind(userId, id)
        .first<{ payload_json: string }>();
      return row ? JSON.parse(row.payload_json) : null;
    },
    async bootstrap(userId, cursor) {
      let index = 0,
        last = '';
      if (cursor) {
        const parsed = JSON.parse(cursor);
        if (
          !Array.isArray(parsed) ||
          parsed.length !== 2 ||
          !Number.isInteger(parsed[0]) ||
          parsed[0] < 0 ||
          parsed[0] >= syncCollections.length ||
          typeof parsed[1] !== 'string' ||
          parsed[1].length > 1000
        )
          throw new Error('Invalid cursor');
        [index, last] = parsed;
      }
      const data = emptySync();
      const prefs = await db
        .prepare('SELECT * FROM user_preferences WHERE user_id=?')
        .bind(userId)
        .first<Record<string, unknown>>();
      if (prefs)
        data.preferences = {
          schemaVersion: 1,
          mode: prefs.mode as 'shadowing' | 'continuous',
          speed: prefs.speed as number,
          studioMode: prefs.studio_mode === 1,
          furigana: prefs.furigana === 1,
          updatedAt: prefs.updated_at as string,
        };
      const kind = syncCollections[index];
      // Composite primary key supplies the user-scoped keyset index, never OFFSET.
      const rows = await db
        .prepare(
          `SELECT id,payload_json FROM ${tables[kind]} WHERE user_id=? AND id>? ORDER BY id LIMIT 51`,
        )
        .bind(userId, last)
        .all<{ id: string; payload_json: string }>();
      const page = rows.results.slice(0, 50);
      Object.assign(data, { [kind]: page.map((r) => JSON.parse(r.payload_json)) });
      return {
        data,
        nextCursor:
          rows.results.length > 50
            ? JSON.stringify([index, page.at(-1)!.id])
            : index + 1 < syncCollections.length
              ? JSON.stringify([index + 1, ''])
              : null,
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
              `INSERT INTO user_preferences(user_id,schema_version,mode,speed,studio_mode,furigana,updated_at) VALUES (?,1,?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET mode=excluded.mode,speed=excluded.speed,studio_mode=excluded.studio_mode,furigana=excluded.furigana,updated_at=excluded.updated_at WHERE excluded.updated_at>user_preferences.updated_at`,
            )
            .bind(userId, p.mode, p.speed, +p.studioMode, +p.furigana, p.updatedAt),
        );
      }
      for (const kind of syncCollections)
        for (const item of data[kind]) {
          const lesson =
            'lesson' in item ? item.lesson : 'archive' in item ? item.archive.lesson : item;
          const updated = 'generatedAt' in item ? item.generatedAt : item.updatedAt,
            table = tables[kind];
          const payload = JSON.stringify(item);
          let conflict = `DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json WHERE excluded.updated_at>${table}.updated_at AND ${table}.lesson_id=excluded.lesson_id AND ${table}.transcript_key=excluded.transcript_key`;
          if (kind === 'archives') conflict = 'DO NOTHING';
          if (kind === 'bookmarks')
            conflict = `DO UPDATE SET updated_at=excluded.updated_at,payload_json=excluded.payload_json WHERE excluded.updated_at>${table}.updated_at OR (excluded.updated_at=${table}.updated_at AND json_extract(excluded.payload_json,'$.deleted')=1)`;
          if (kind === 'lessons')
            conflict = `DO UPDATE SET
          updated_at=MAX(updated_at,excluded.updated_at),
          payload_json=json_set(CASE WHEN excluded.updated_at>${table}.updated_at THEN excluded.payload_json ELSE ${table}.payload_json END,
          '$.completed',json(CASE WHEN json_extract(${table}.payload_json,'$.completed') OR json_extract(excluded.payload_json,'$.completed') THEN 'true' ELSE 'false' END),
          '$.completedAt',CASE WHEN json_extract(${table}.payload_json,'$.completedAt') IS NULL THEN json_extract(excluded.payload_json,'$.completedAt') WHEN json_extract(excluded.payload_json,'$.completedAt') IS NULL THEN json_extract(${table}.payload_json,'$.completedAt') ELSE MAX(json_extract(${table}.payload_json,'$.completedAt'),json_extract(excluded.payload_json,'$.completedAt')) END)`;
          statements.push(
            db
              .prepare(
                `INSERT INTO ${table}(user_id,id,lesson_id,transcript_key,updated_at,payload_json) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,id) ${conflict}`,
              )
              .bind(userId, item.id, lesson.lessonId, lesson.transcriptKey, updated, payload),
          );
        }
      // D1 batches are atomic; the client sends bounded batches and retries idempotently.
      if (statements.length) await db.batch(statements);
    },
  };
}
