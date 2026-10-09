import type { DictionaryDatabase, DictionaryStatement } from '../dictionary/repository';
import { scheduleReview } from '../review-scheduler';
import type { ReviewRepository, ReviewState } from './types';
import type { ReviewEvent } from './history';
export class ReviewConflict extends Error {}
export interface ReviewDatabase extends DictionaryDatabase {
  batch(statements: DictionaryStatement[]): Promise<unknown>;
}
const cardColumns = `entry_id AS entryId,schema_version AS schemaVersion,algorithm,status,
due_at AS dueAt,last_reviewed_at AS lastReviewedAt,interval_days AS intervalDays,ease,
repetitions,lapses,revision,last_operation_id AS lastOperationId,created_at AS createdAt,updated_at AS updatedAt`;
type StoredReview = ReviewState & { lastOperationId: string | null };
export function createD1ReviewRepository(db: ReviewDatabase): ReviewRepository {
  return {
    async snapshot(userId) {
      const now = new Date();
      const recentSince = new Date(now.getTime() - 7 * 86_400_000).toISOString();
      const metadata = await db
        .prepare(
          'SELECT first_recorded_at AS firstRecordedAt FROM review_event_metadata WHERE id=1',
        )
        .first<{ firstRecordedAt: string }>();
      const historySince =
        metadata?.firstRecordedAt && metadata.firstRecordedAt > recentSince
          ? metadata.firstRecordedAt
          : recentSince;
      const cards = await db
        .prepare(
          `SELECT ${cardColumns} FROM user_review_states WHERE user_id=? ORDER BY due_at,entry_id`,
        )
        .bind(userId)
        .all<ReviewState>();
      const history = await db
        .prepare(
          `SELECT operation_id AS operationId,entry_id AS entryId,grade,status,reviewed_at AS reviewedAt FROM user_review_events WHERE user_id=? AND reviewed_at>=? ORDER BY reviewed_at DESC,operation_id DESC LIMIT 10000`,
        )
        // Queued offline ratings may predate migration; retain them as accepted
        // additions without claiming older device history is authoritative.
        .bind(userId, recentSince)
        .all<ReviewEvent>();
      return {
        cards: cards.results,
        history: history.results.reverse(),
        historySince,
        historyWindowStart: recentSince,
      };
    },
    async apply(userId, op) {
      const now = new Date().toISOString();
      if (op.action === 'enroll') {
        const entryIds = [...new Set(op.entryIds)];
        // D1 binds at most 100 parameters per statement: the user id plus 99 entry ids.
        let found = 0;
        for (let offset = 0; offset < entryIds.length; offset += 99) {
          const group = entryIds.slice(offset, offset + 99);
          found += (
            await db
              .prepare(
                `SELECT id FROM user_dictionary_entries WHERE user_id=? AND id IN (${group.map(() => '?').join(',')})`,
              )
              .bind(userId, ...group)
              .all<{ id: string }>()
          ).results.length;
        }
        if (found !== entryIds.length)
          throw new ReviewConflict('A selected word was removed. Refresh your dictionary.');
        const enrolled = new Date(op.enrolledAt).toISOString();
        const statements: DictionaryStatement[] = [];
        for (const id of entryIds)
          statements.push(
            db
              .prepare(
                `INSERT OR IGNORE INTO user_review_states(user_id,entry_id,schema_version,algorithm,status,due_at,last_reviewed_at,interval_days,ease,repetitions,lapses,revision,created_at,updated_at) VALUES (?,?,1,'sm2-v1','new',?,NULL,0,2.5,0,0,0,?,?)`,
              )
              .bind(userId, id, enrolled, enrolled, enrolled),
            db
              .prepare(
                `UPDATE user_review_states SET status='new',due_at=?,revision=revision+1,updated_at=? WHERE user_id=? AND entry_id=? AND status='suspended'`,
              )
              .bind(enrolled, enrolled, userId, id),
          );
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
        if (
          op.action === 'undo' &&
          (card.lastOperationId !== op.targetOperationId ||
            op.previous.entryId !== card.entryId ||
            op.previous.revision !== card.revision - 1 ||
            op.previous.createdAt !== card.createdAt ||
            Date.parse(op.undoneAt) < Date.parse(card.updatedAt))
        )
          throw new ReviewConflict('The last rating changed. Refresh before correcting it.');
        const next =
          op.action === 'grade'
            ? scheduleReview(card, op.grade, op.reviewedAt)
            : op.action === 'undo'
              ? { ...op.previous, revision: card.revision + 1, updatedAt: op.undoneAt }
              : { ...card, status: 'suspended', updatedAt: now, revision: card.revision + 1 };
        const update = db
          .prepare(
            `UPDATE user_review_states SET status=?,due_at=?,last_reviewed_at=?,interval_days=?,ease=?,repetitions=?,lapses=?,revision=?,updated_at=?,last_operation_id=? WHERE user_id=? AND entry_id=? AND revision=?${op.action === 'grade' ? ' AND NOT EXISTS (SELECT 1 FROM user_review_events WHERE user_id=? AND operation_id=?)' : ''}`,
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
            ...(op.action === 'grade' ? [userId, op.operationId] : []),
          );
        const mutations: DictionaryStatement[] = [update];
        if (op.action === 'grade')
          mutations.push(
            db
              .prepare(
                `INSERT OR IGNORE INTO user_review_events(user_id,operation_id,entry_id,grade,status,reviewed_at) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM user_review_states WHERE user_id=? AND entry_id=? AND revision=? AND last_operation_id=?)`,
              )
              .bind(
                userId,
                op.operationId,
                op.entryId,
                op.grade,
                card.status,
                op.reviewedAt,
                userId,
                op.entryId,
                next.revision,
                op.operationId,
              ),
          );
        else if (op.action === 'undo')
          mutations.push(
            db
              .prepare(
                `DELETE FROM user_review_events WHERE user_id=? AND entry_id=? AND operation_id=? AND EXISTS (SELECT 1 FROM user_review_states WHERE user_id=? AND entry_id=? AND revision=? AND last_operation_id=?)`,
              )
              .bind(
                userId,
                op.entryId,
                op.targetOperationId,
                userId,
                op.entryId,
                next.revision,
                op.operationId,
              ),
          );
        // D1 batches are atomic: an accepted schedule and its rating record commit
        // together, and a losing revision cannot add or erase another rating.
        await db.batch(mutations);
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
