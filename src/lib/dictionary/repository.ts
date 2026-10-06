import type { DictionaryEntry, DictionaryRepository, DictionarySaveInput } from './types';
import { normalizeDictionaryTerm } from './validation';
import {
  dictionaryCursor,
  parseDictionaryCursor,
  validateDictionaryIds,
  validateDictionaryQuery,
} from './query';
import type { Tag } from '../tags/types';

export interface DictionaryStatement {
  bind(...values: (string | number | null)[]): DictionaryStatement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface DictionaryDatabase {
  prepare(sql: string): DictionaryStatement;
}

type DictionaryRow = {
  id: string;
  term: string;
  normalized_term: string;
  reading: string | null;
  translation: string;
  source_sentence: string;
  source_sentence_translation: string;
  lesson_id: string;
  segment_id: string;
  lesson_title: string;
  lesson_author: string;
  media_type: DictionaryEntry['source']['mediaType'];
  media_id: string | null;
  media_url: string | null;
  media_content_key: string | null;
  transcript_key: string;
  section_start: number;
  section_end: number;
  created_at: string;
  updated_at: string;
};

function entry(row: DictionaryRow): DictionaryEntry {
  return {
    schemaVersion: 1,
    id: row.id,
    term: row.term,
    normalizedTerm: row.normalized_term,
    reading: row.reading,
    translation: row.translation,
    sourceSentence: row.source_sentence,
    sourceSentenceTranslation: row.source_sentence_translation,
    source: {
      lessonId: row.lesson_id,
      segmentId: row.segment_id,
      lessonTitle: row.lesson_title,
      lessonAuthor: row.lesson_author,
      mediaType: row.media_type,
      mediaId: row.media_id,
      mediaUrl: row.media_url,
      mediaContentKey: row.media_content_key,
      transcriptKey: row.transcript_key,
      start: row.section_start,
      end: row.section_end,
    },
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const columns = `id,term,normalized_term,reading,translation,source_sentence,
source_sentence_translation,lesson_id,segment_id,lesson_title,lesson_author,media_type,media_id,
media_url,media_content_key,transcript_key,section_start,section_end,created_at,updated_at`;

export function createD1DictionaryRepository(db: DictionaryDatabase): DictionaryRepository {
  async function hydrate(userId: string, entries: DictionaryEntry[]) {
    for (let i = 0; i < entries.length; i += 50) {
      const part = entries.slice(i, i + 50);
      const rows = await db
        .prepare(
          `SELECT m.entry_id AS entryId,t.id,t.name,t.normalized_name AS normalizedName,t.created_at AS createdAt,t.updated_at AS updatedAt FROM user_dictionary_tags m JOIN user_tags t ON t.user_id=m.user_id AND t.id=m.tag_id WHERE m.user_id=? AND m.entry_id IN (${part.map(() => '?').join(',')}) ORDER BY t.normalized_name,t.id`,
        )
        .bind(userId, ...part.map((e) => e.id))
        .all<Tag & { entryId: string }>();
      for (const e of part)
        e.tags = rows.results
          .filter((r) => r.entryId === e.id)
          .map(({ id, name, normalizedName, createdAt, updatedAt }) => ({
            id,
            name,
            normalizedName,
            createdAt,
            updatedAt,
          }));
    }
    return entries;
  }
  const repository: DictionaryRepository = {
    async page(userId, input) {
      const query = validateDictionaryQuery(input);
      const conditions = ['user_id=?'];
      const values: (string | number)[] = [userId];
      for (const [field, value] of [
        ['normalized_term', query.term],
        ['lesson_id', query.lessonId],
        ['transcript_key', query.transcriptKey],
      ] as const)
        if (value) {
          conditions.push(`${field}=?`);
          values.push(value);
        }
      for (const [table, field, value] of [
        ['user_deck_entries', 'deck_id', query.deckId],
        ['user_dictionary_tags', 'tag_id', query.tagId],
      ] as const)
        if (value) {
          conditions.push(`id IN (SELECT entry_id FROM ${table} WHERE user_id=? AND ${field}=?)`);
          values.push(userId, value);
        }
      if (query.cursor) {
        const cursor = parseDictionaryCursor(query.cursor);
        conditions.push('(created_at,id)<(?,?)');
        values.push(cursor.createdAt, cursor.id);
      }
      const rows = await db
        .prepare(
          `SELECT ${columns} FROM user_dictionary_entries WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC,id DESC LIMIT ?`,
        )
        .bind(...values, query.limit + 1)
        .all<DictionaryRow>();
      const entries = await hydrate(userId, rows.results.slice(0, query.limit).map(entry));
      const last = entries.at(-1);
      return {
        entries,
        nextCursor:
          rows.results.length > query.limit && last
            ? dictionaryCursor(last.createdAt, last.id)
            : null,
      };
    },
    async byIds(userId, input) {
      const ids = validateDictionaryIds(input);
      const rows = await db
        .prepare(
          `SELECT ${columns} FROM user_dictionary_entries WHERE user_id=? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY created_at DESC,id DESC`,
        )
        .bind(userId, ...ids)
        .all<DictionaryRow>();
      return hydrate(userId, rows.results.map(entry));
    },
    async list(userId) {
      // Compatibility facade for explicit full traversal. UI consumers use bounded queries.
      const entries: DictionaryEntry[] = [];
      let cursor: string | null = null;
      do {
        const page = await repository.page(userId, { cursor });
        entries.push(...page.entries);
        cursor = page.nextCursor;
      } while (cursor);
      return entries;
    },
    async save(userId: string, input: DictionarySaveInput) {
      const normalized = normalizeDictionaryTerm(input.term);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      const s = input.source;
      await db
        .prepare(
          `INSERT INTO user_dictionary_entries(
            user_id,id,schema_version,term,normalized_term,reading,translation,source_sentence,
            source_sentence_translation,lesson_id,segment_id,lesson_title,lesson_author,media_type,
            media_id,media_url,media_content_key,transcript_key,section_start,section_end,created_at,updated_at
          ) VALUES (?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id,normalized_term,lesson_id,segment_id) DO UPDATE SET
            term=excluded.term,reading=excluded.reading,translation=excluded.translation,
            source_sentence=excluded.source_sentence,
            source_sentence_translation=excluded.source_sentence_translation,
            lesson_title=excluded.lesson_title,lesson_author=excluded.lesson_author,
            media_type=excluded.media_type,media_id=excluded.media_id,media_url=excluded.media_url,
            media_content_key=excluded.media_content_key,transcript_key=excluded.transcript_key,
            section_start=excluded.section_start,section_end=excluded.section_end,
            updated_at=excluded.updated_at`,
        )
        .bind(
          userId,
          id,
          input.term,
          normalized,
          input.reading,
          input.translation,
          input.sourceSentence,
          input.sourceSentenceTranslation,
          s.lessonId,
          s.segmentId,
          s.lessonTitle,
          s.lessonAuthor,
          s.mediaType,
          s.mediaId,
          s.mediaUrl,
          s.mediaContentKey,
          s.transcriptKey,
          s.start,
          s.end,
          now,
          now,
        )
        .run();
      const row = await db
        .prepare(
          `SELECT ${columns} FROM user_dictionary_entries WHERE user_id=? AND normalized_term=? AND lesson_id=? AND segment_id=?`,
        )
        .bind(userId, normalized, s.lessonId, s.segmentId)
        .first<DictionaryRow>();
      if (!row) throw new Error('Dictionary write unavailable');
      await db
        .prepare(
          `INSERT OR IGNORE INTO user_decks(user_id,id,name,created_at,updated_at) VALUES (?,'inbox','Inbox',?,?)`,
        )
        .bind(userId, now, now)
        .run();
      await db
        .prepare(
          `INSERT OR IGNORE INTO user_deck_entries(user_id,deck_id,entry_id) VALUES (?,'inbox',?)`,
        )
        .bind(userId, row.id)
        .run();
      return (await hydrate(userId, [entry(row)]))[0];
    },
    async remove(userId, id) {
      await db
        .prepare('DELETE FROM user_dictionary_entries WHERE user_id=? AND id=?')
        .bind(userId, id)
        .run();
    },
  };
  return repository;
}
