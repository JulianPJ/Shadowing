import type { D1Database } from '../d1';
import { BodyLimitError, readBoundedText } from '../http-body';
import { normalizeDictionaryTerm } from '../dictionary/validation';
import { validateKnowledgeRecord } from '../knowledge/validation';
import type { ImportRecord, ImportResult } from './types';
import { roles } from './types';

export async function contentHash(value: string) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export function validateImportRecord(value: unknown): ImportRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid import record');
  const r = value as ImportRecord;
  const limits = [120, 120, 2000, 5000, 10000];
  for (const [i, role] of roles.entries())
    if (
      typeof r[role] !== 'string' ||
      r[role].length > limits[i] ||
      /[\u0000-\u0008\u000b-\u001f]/.test(r[role])
    )
      throw new Error('Invalid import text');
  if (
    !r.term.trim() ||
    r.term !== r.term.trim() ||
    /[\t\n<>]/.test(r.term) ||
    !['known', 'learning'].includes(r.state)
  )
    throw new Error('Invalid word');
  validateKnowledgeRecord({
    lemma: r.term,
    reading: r.reading || null,
    state: r.state,
    updatedAt: new Date().toISOString(),
  });
  if (
    !Array.isArray(r.decks) ||
    !r.decks.length ||
    r.decks.length > 8 ||
    r.decks.some(
      (d) => typeof d !== 'string' || !d.trim() || d.length > 240 || /[\u0000-\u001f<>]/.test(d),
    )
  )
    throw new Error('Invalid deck names');
  return Object.fromEntries([
    ...roles.map((k) => [k, r[k]]),
    ['state', r.state],
    ['decks', [...new Set(r.decks)]],
  ]) as ImportRecord;
}
type Match = {
  id: string;
  term: string;
  reading: string | null;
  translation: string;
  source_sentence: string;
  source_sentence_translation: string;
  created_at: string;
};
type MetaResult = { meta?: { rows_read?: number; rows_written?: number } };

/** At most three records and eight memberships per request, below the Free query ceiling. */
export async function importBatch(
  db: D1Database,
  userId: string,
  records: ImportRecord[],
  commit: boolean,
  distinct: boolean,
) {
  const result: ImportResult = {
    imported: 0,
    duplicates: 0,
    ambiguous: 0,
    skipped: 0,
    known: 0,
    learning: 0,
    preserved: 0,
    rowsRead: 0,
    rowsWritten: 0,
  };
  const measure = (r: MetaResult) => {
    result.rowsRead += r.meta?.rows_read ?? 0;
    result.rowsWritten += r.meta?.rows_written ?? 0;
  };
  const prepared = await Promise.all(
    records.map(async (r) => ({
      r,
      key: await contentHash(JSON.stringify(roles.map((role) => r[role]))),
    })),
  );
  const unique = [...new Map(prepared.map((p) => [p.key, p])).values()];
  const now = new Date().toISOString();
  for (const { r, key } of unique) {
    const keyed = await db
      .prepare(
        'SELECT entry_id,entry_created_at FROM user_vocabulary_import_keys WHERE user_id=? AND content_key=?',
      )
      .bind(userId, key)
      .all<{ entry_id: string; entry_created_at: string }>();
    measure(keyed);
    let id: string | undefined = keyed.results[0]?.entry_id;
    let createdAt = keyed.results[0]?.entry_created_at ?? now;
    let existing: Match[] = [];
    if (!id) {
      const matches = await db
        .prepare(
          'SELECT id,term,reading,translation,source_sentence,source_sentence_translation,created_at FROM user_dictionary_entries WHERE user_id=? AND normalized_term=? LIMIT 101',
        )
        .bind(userId, normalizeDictionaryTerm(r.term))
        .all<Match>();
      measure(matches);
      existing = matches.results;
      const exact = existing.find(
        (e) =>
          (e.reading ?? '') === r.reading &&
          e.translation === r.translation &&
          e.source_sentence === r.sourceSentence &&
          e.source_sentence_translation === r.sourceSentenceTranslation,
      );
      id = exact?.id;
      createdAt = exact?.created_at ?? now;
    }
    const duplicate = !!id;
    if (!id && existing.length) {
      result.ambiguous++;
      (result.conflicts ??= []).push({
        term: r.term,
        incoming: r.translation,
        existing: existing
          .slice(0, 3)
          .map((e) => `${e.reading ?? ''} · ${e.translation} · ${e.source_sentence}`)
          .join(' / '),
      });
      if (!distinct) {
        result.skipped++;
        continue;
      }
    }
    // A deleted context gets a fresh entry ID, so an older client's queued
    // grading operation cannot accidentally apply to its later re-import.
    id ??= crypto.randomUUID();
    if (duplicate) {
      result.duplicates++;
      result.preserved++;
    } else {
      const choice = await db
        .prepare(
          `SELECT state FROM user_word_knowledge WHERE user_id=? AND lemma=? UNION ALL SELECT CASE WHEN EXISTS (SELECT 1 FROM user_review_states s JOIN user_dictionary_entries e ON e.user_id=s.user_id AND e.id=s.entry_id WHERE s.user_id=? AND e.normalized_term=? AND s.status!='suspended') THEN 'learning' ELSE 'known' END WHERE ?=1 LIMIT 1`,
        )
        .bind(userId, r.term, userId, normalizeDictionaryTerm(r.term), existing.length ? 1 : 0)
        .all<{ state: string }>();
      measure(choice);
      const state = choice.results[0]?.state ?? r.state;
      if (choice.results.length) result.preserved++;
      if (state === 'known') result.known++;
      if (state === 'learning') result.learning++;
      result.imported++;
    }
    if (!commit) continue;
    const source = JSON.stringify({ kind: 'anki', collection: r.decks[0], contentKey: key });
    const statements = [];
    if (!duplicate) {
      const usage = await db
        .prepare('SELECT contexts FROM user_vocabulary_import_usage WHERE user_id=? AND day=?')
        .bind(userId, now.slice(0, 10))
        .all<{ contexts: number }>();
      measure(usage);
      if ((usage.results[0]?.contexts ?? 0) >= 1000)
        throw new Error(
          'Daily import limit reached. Continue tomorrow; saved batches are safe to repeat.',
        );
      statements.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO user_vocabulary_import_usage(user_id,day,contexts) VALUES (?,?,0)',
          )
          .bind(userId, now.slice(0, 10)),
        db
          .prepare(
            'UPDATE user_vocabulary_import_usage SET contexts=contexts+1 WHERE user_id=? AND day=? AND contexts<1000',
          )
          .bind(userId, now.slice(0, 10)),
      );
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO user_dictionary_entries(user_id,id,schema_version,term,normalized_term,reading,translation,source_sentence,source_sentence_translation,lesson_id,segment_id,lesson_title,lesson_author,media_type,transcript_key,section_start,section_end,created_at,updated_at,import_source) SELECT ?,?,1,?,?,?,?,?,?,'',?,?,'Anki','local','',0,0,?,?,? WHERE changes()=1`,
          )
          .bind(
            userId,
            id,
            r.term,
            normalizeDictionaryTerm(r.term),
            r.reading || null,
            r.translation,
            r.sourceSentence,
            r.sourceSentenceTranslation,
            key,
            r.decks[0],
            now,
            now,
            source,
          ),
      );
    }
    statements.push(
      db
        .prepare(
          'INSERT OR IGNORE INTO user_vocabulary_import_keys(user_id,content_key,entry_id,entry_created_at) VALUES (?,?,?,?)',
        )
        .bind(userId, key, id, createdAt),
    );
    if (!duplicate) {
      // Existing explicit status always wins. No Anki event, FSRS state or interval is imported.
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO user_word_knowledge(user_id,lemma,reading,state,updated_at,synced_at)
            SELECT ?,?,?,CASE WHEN ?
            THEN CASE WHEN EXISTS (SELECT 1 FROM user_review_states s JOIN user_dictionary_entries e ON e.user_id=s.user_id AND e.id=s.entry_id WHERE s.user_id=? AND e.normalized_term=? AND s.status!='suspended') THEN 'learning' ELSE 'known' END
            ELSE ? END,?,?`,
          )
          .bind(
            userId,
            r.term,
            r.reading || null,
            existing.length ? 1 : 0,
            userId,
            normalizeDictionaryTerm(r.term),
            r.state,
            now,
            now,
          ),
      );
      statements.push(
        db
          .prepare(
            `INSERT OR IGNORE INTO user_review_states(user_id,entry_id,schema_version,algorithm,status,due_at,interval_days,ease,repetitions,lapses,revision,created_at,updated_at) SELECT ?,?,1,'sm2-v1','new',?,0,2.5,0,0,0,?,? WHERE EXISTS (SELECT 1 FROM user_word_knowledge WHERE user_id=? AND lemma=? AND state='learning') AND NOT EXISTS (SELECT 1 FROM user_review_states s JOIN user_dictionary_entries e ON e.user_id=s.user_id AND e.id=s.entry_id WHERE s.user_id=? AND e.normalized_term=? AND s.status!='suspended')`,
          )
          .bind(userId, id, now, now, now, userId, r.term, userId, normalizeDictionaryTerm(r.term)),
      );
    }
    for (const deck of r.decks) {
      const deckId = await contentHash(deck);
      statements.push(
        db
          .prepare(
            'INSERT OR IGNORE INTO user_vocabulary_collections(user_id,id,name) VALUES (?,?,?)',
          )
          .bind(userId, deckId, deck),
        db
          .prepare(
            'INSERT OR IGNORE INTO user_vocabulary_memberships(user_id,collection_id,entry_id,created_at) VALUES (?,?,?,?)',
          )
          .bind(userId, deckId, id, createdAt),
      );
    }
    const saved = await db.batch(statements);
    for (const s of saved) measure(s);
  }
  return result;
}

export async function handleAnkiRequest(
  request: Request,
  userId: string,
  verified: boolean,
  db: D1Database,
) {
  const respond = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  if (!verified) return respond({ error: 'Verify your email before importing vocabulary.' }, 403);
  if (request.method !== 'POST') return respond({ error: 'Method not supported' }, 405);
  try {
    const body = JSON.parse(await readBoundedText(request, 128000));
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      !['preview', 'import'].includes(body.action) ||
      !Array.isArray(body.records) ||
      body.records.length < 1 ||
      body.records.length > 3 ||
      typeof body.distinct !== 'boolean'
    )
      return respond({ error: 'Invalid import batch' }, 400);
    const records = body.records.map(validateImportRecord) as ImportRecord[];
    if (records.reduce((n, r) => n + r.decks.length, 0) > 8)
      return respond({ error: 'Invalid import batch' }, 400);
    return respond(await importBatch(db, userId, records, body.action === 'import', body.distinct));
  } catch (error) {
    if (error instanceof BodyLimitError)
      return respond({ error: 'Import request is too large. Use smaller batches.' }, 413);
    if (error instanceof SyntaxError) return respond({ error: 'Invalid import request.' }, 400);
    const message = error instanceof Error ? error.message : '';
    return respond(
      {
        error: message.startsWith('Daily import')
          ? message
          : message.startsWith('Invalid')
            ? 'Invalid import record. Check your mappings.'
            : 'Import interrupted. Retry to continue safely.',
      },
      message.startsWith('Daily import') ? 429 : message.startsWith('Invalid') ? 400 : 503,
    );
  }
}
