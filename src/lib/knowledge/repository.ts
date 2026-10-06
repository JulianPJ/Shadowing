import type { ProgressDatabase } from '../sync/repository';
import type { KnowledgePage, KnowledgeRepository, WordKnowledgeRecord } from './types';
import { validateKnowledgeRecord } from './validation';
export class D1KnowledgeRepository implements KnowledgeRepository {
  constructor(private database: ProgressDatabase) {}
  async page(userId: string, cursor?: string | null): Promise<KnowledgePage> {
    if (cursor && (cursor.length > 120 || /[\u0000-\u001f]/.test(cursor)))
      throw new Error('Invalid cursor');
    const result = await this.database
      .prepare(
        'SELECT lemma, reading, state, updated_at AS updatedAt FROM user_word_knowledge WHERE user_id = ? AND lemma > ? ORDER BY lemma LIMIT 251',
      )
      .bind(userId, cursor ?? '')
      .all<WordKnowledgeRecord>();
    const records = result.results.slice(0, 250).map(validateKnowledgeRecord);
    return { records, nextCursor: result.results.length > 250 ? records.at(-1)!.lemma : null };
  }
  async apply(userId: string, records: WordKnowledgeRecord[]) {
    const statements = records.map((input) => {
      const record = validateKnowledgeRecord(input);
      return this.database
        .prepare(
          `INSERT INTO user_word_knowledge (user_id,lemma,reading,state,updated_at) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id,lemma) DO UPDATE SET reading=excluded.reading,state=excluded.state,updated_at=excluded.updated_at
        WHERE excluded.updated_at > user_word_knowledge.updated_at OR (excluded.updated_at = user_word_knowledge.updated_at AND (excluded.state > user_word_knowledge.state OR (excluded.state = user_word_knowledge.state AND COALESCE(excluded.reading,'') > COALESCE(user_word_knowledge.reading,''))))`,
        )
        .bind(userId, record.lemma, record.reading, record.state, record.updatedAt);
    });
    if (statements.length) await this.database.batch(statements);
  }
}
