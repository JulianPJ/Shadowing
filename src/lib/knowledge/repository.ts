import type { ProgressDatabase } from '../sync/repository';
import type { KnowledgePage, KnowledgeRepository, WordKnowledgeRecord } from './types';
import { validateKnowledgeRecord } from './validation';

const validSince = (value: string) => Number.isFinite(Date.parse(value)) && value.length <= 40;

export class D1KnowledgeRepository implements KnowledgeRepository {
  constructor(
    private database: ProgressDatabase,
    private clock = () => new Date(),
  ) {}
  /**
   * Pages by lemma. With `since`, only rows the server changed at or after that time are
   * returned; `syncedThrough` is the server time to pass as the next `since`.
   */
  async page(
    userId: string,
    cursor?: string | null,
    since?: string | null,
  ): Promise<KnowledgePage> {
    if (cursor && (cursor.length > 120 || /[\u0000-\u001f]/.test(cursor)))
      throw new Error('Invalid cursor');
    if (since && !validSince(since)) throw new Error('Invalid since');
    const syncedThrough = this.clock().toISOString();
    const result = await this.database
      .prepare(
        `SELECT lemma, reading, state, updated_at AS updatedAt FROM user_word_knowledge WHERE user_id = ? AND lemma > ?${since ? ' AND synced_at >= ?' : ''} ORDER BY lemma LIMIT 251`,
      )
      .bind(userId, cursor ?? '', ...(since ? [new Date(since).toISOString()] : []))
      .all<WordKnowledgeRecord>();
    const records = result.results.slice(0, 250).map(validateKnowledgeRecord);
    return {
      records,
      nextCursor: result.results.length > 250 ? records.at(-1)!.lemma : null,
      syncedThrough,
    };
  }
  async apply(userId: string, records: WordKnowledgeRecord[]) {
    const syncedAt = this.clock().toISOString();
    const statements = records.map((input) => {
      const record = validateKnowledgeRecord(input);
      return this.database
        .prepare(
          `INSERT INTO user_word_knowledge (user_id,lemma,reading,state,updated_at,synced_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id,lemma) DO UPDATE SET reading=excluded.reading,state=excluded.state,updated_at=excluded.updated_at,synced_at=excluded.synced_at
        WHERE excluded.updated_at > user_word_knowledge.updated_at OR (excluded.updated_at = user_word_knowledge.updated_at AND (excluded.state > user_word_knowledge.state OR (excluded.state = user_word_knowledge.state AND COALESCE(excluded.reading,'') > COALESCE(user_word_knowledge.reading,''))))`,
        )
        .bind(userId, record.lemma, record.reading, record.state, record.updatedAt, syncedAt);
    });
    if (statements.length) await this.database.batch(statements);
    // An upload that loses last-writer-wins changes nothing, so its device would never pull the
    // winner incrementally. Return the stored values so the client can adopt them.
    const lemmas = [...new Set(records.map((record) => record.lemma))];
    const stored: WordKnowledgeRecord[] = [];
    // D1 binds at most 100 parameters per statement: the user id plus 99 lemmas.
    for (let offset = 0; offset < lemmas.length; offset += 99) {
      const group = lemmas.slice(offset, offset + 99);
      const result = await this.database
        .prepare(
          `SELECT lemma, reading, state, updated_at AS updatedAt FROM user_word_knowledge WHERE user_id = ? AND lemma IN (${group.map(() => '?').join(',')})`,
        )
        .bind(userId, ...group)
        .all<WordKnowledgeRecord>();
      stored.push(...result.results.map(validateKnowledgeRecord));
    }
    return stored;
  }
}
