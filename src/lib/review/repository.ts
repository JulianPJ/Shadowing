import type { DictionaryDatabase, DictionaryStatement } from '../dictionary/repository';
import type { Deck, DeckMembership } from '../decks/types';
import { scheduleReview } from '../review-scheduler';
import type { ReviewRepository, ReviewState } from './types';
export class ReviewConflict extends Error {}
export interface ReviewDatabase extends DictionaryDatabase {
  batch(statements: DictionaryStatement[]): Promise<unknown>;
}
const cardColumns = `entry_id AS entryId,schema_version AS schemaVersion,algorithm,status,
due_at AS dueAt,last_reviewed_at AS lastReviewedAt,interval_days AS intervalDays,ease,
repetitions,lapses,revision,last_operation_id AS lastOperationId,created_at AS createdAt,updated_at AS updatedAt`;
type StoredReview = ReviewState & { lastOperationId: string | null };
export function createD1ReviewRepository(db: ReviewDatabase): ReviewRepository {
  const inbox = (userId: string, now: string) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO user_decks(user_id,id,name,created_at,updated_at) VALUES (?,'inbox','Inbox',?,?)`,
      )
      .bind(userId, now, now);
  return {
    async snapshot(userId) {
      await inbox(userId, new Date().toISOString()).run();
      const decks = await db
        .prepare(
          `SELECT id,name,created_at AS createdAt,updated_at AS updatedAt FROM user_decks WHERE user_id=? ORDER BY id='inbox' DESC,name,id`,
        )
        .bind(userId)
        .all<Deck>();
      const memberships = await db
        .prepare(
          'SELECT deck_id AS deckId,entry_id AS entryId FROM user_deck_entries WHERE user_id=? ORDER BY deck_id,entry_id',
        )
        .bind(userId)
        .all<DeckMembership>();
      const cards = await db
        .prepare(
          `SELECT ${cardColumns} FROM user_review_states WHERE user_id=? ORDER BY due_at,entry_id`,
        )
        .bind(userId)
        .all<ReviewState>();
      return { decks: decks.results, memberships: memberships.results, cards: cards.results };
    },
    async apply(userId, op) {
      const now = new Date().toISOString();
      if (op.action === 'deck') {
        if (
          await db
            .prepare('SELECT id FROM user_decks WHERE user_id=? AND id=?')
            .bind(userId, op.id)
            .first()
        )
          return;
        const count = await db
          .prepare('SELECT count(*) AS n FROM user_decks WHERE user_id=?')
          .bind(userId)
          .first<{ n: number }>();
        if ((count?.n ?? 0) >= 100) throw new Error('Invalid deck limit');
        await db
          .prepare(
            'INSERT OR IGNORE INTO user_decks(user_id,id,name,created_at,updated_at) VALUES (?,?,?,?,?)',
          )
          .bind(userId, op.id, op.name.trim(), now, now)
          .run();
      } else if (op.action === 'delete-deck') {
        if (op.deckId === 'inbox') throw new Error('Invalid default deck deletion');
        await db
          .prepare('DELETE FROM user_decks WHERE user_id=? AND id=?')
          .bind(userId, op.deckId)
          .run();
      } else if (op.action === 'membership' || op.action === 'enroll') {
        if (
          op.deckId !== 'inbox' &&
          !(await db
            .prepare('SELECT id FROM user_decks WHERE user_id=? AND id=?')
            .bind(userId, op.deckId)
            .first())
        )
          throw new ReviewConflict('This deck was removed. Refresh your collections.');
        if (op.action === 'enroll' || !op.remove) {
          const found = await db
            .prepare(
              `SELECT id FROM user_dictionary_entries WHERE user_id=? AND id IN (${op.entryIds.map(() => '?').join(',')})`,
            )
            .bind(userId, ...op.entryIds)
            .all<{ id: string }>();
          if (found.results.length !== new Set(op.entryIds).size)
            throw new ReviewConflict('A selected word was removed. Refresh your dictionary.');
        }
        const statements: DictionaryStatement[] = [inbox(userId, now)];
        for (const id of new Set(op.entryIds)) {
          statements.push(
            op.action === 'membership' && op.remove
              ? db
                  .prepare(
                    'DELETE FROM user_deck_entries WHERE user_id=? AND deck_id=? AND entry_id=?',
                  )
                  .bind(userId, op.deckId, id)
              : db
                  .prepare(
                    'INSERT OR IGNORE INTO user_deck_entries(user_id,deck_id,entry_id) VALUES (?,?,?)',
                  )
                  .bind(userId, op.deckId, id),
          );
          if (op.action === 'enroll') {
            const enrolled = new Date(op.enrolledAt).toISOString();
            statements.push(
              db
                .prepare(
                  `INSERT OR IGNORE INTO user_review_states(user_id,entry_id,schema_version,algorithm,status,due_at,last_reviewed_at,interval_days,ease,repetitions,lapses,revision,created_at,updated_at) VALUES (?,?,1,'sm2-v1','new',?,NULL,0,2.5,0,0,0,?,?)`,
                )
                .bind(userId, id, enrolled, enrolled, enrolled),
            );
            statements.push(
              db
                .prepare(
                  `UPDATE user_review_states SET status='new',due_at=?,revision=revision+1,updated_at=? WHERE user_id=? AND entry_id=? AND status='suspended'`,
                )
                .bind(enrolled, enrolled, userId, id),
            );
          }
        }
        await db.batch(statements);
      } else {
        const card = await db
          .prepare(`SELECT ${cardColumns} FROM user_review_states WHERE user_id=? AND entry_id=?`)
          .bind(userId, op.entryId)
          .first<StoredReview>();
        if (!card) throw new ReviewConflict('The word was removed. Refresh review.');
        if (card.revision !== op.revision) {
          // A lost response can retry the same grading operation safely.
          if (card.revision === op.revision + 1 && card.lastOperationId === op.operationId) return;
          throw new ReviewConflict('This word changed on another device. Refresh review.');
        }
        const next =
          op.action === 'grade'
            ? scheduleReview(card, op.grade, op.reviewedAt)
            : { ...card, status: 'suspended', updatedAt: now, revision: card.revision + 1 };
        await db
          .prepare(
            `UPDATE user_review_states SET status=?,due_at=?,last_reviewed_at=?,interval_days=?,ease=?,repetitions=?,lapses=?,revision=?,updated_at=?,last_operation_id=? WHERE user_id=? AND entry_id=? AND revision=?`,
          )
          .bind(
            next.status,
            next.dueAt,
            next.lastReviewedAt,
            next.intervalDays,
            next.ease,
            next.repetitions,
            next.lapses,
            next.revision,
            next.updatedAt,
            op.operationId,
            userId,
            op.entryId,
            op.revision,
          )
          .run();
        const saved = await db
          .prepare(`SELECT ${cardColumns} FROM user_review_states WHERE user_id=? AND entry_id=?`)
          .bind(userId, op.entryId)
          .first<StoredReview>();
        if (!saved || saved.revision !== next.revision || saved.lastOperationId !== op.operationId)
          throw new ReviewConflict('This word changed on another device. Refresh review.');
      }
    },
  };
}
