import type { ReviewDatabase } from '../review/repository';
import { DictionaryValidationError } from '../dictionary/validation';
import { TAG_ACCOUNT_MAX, TAG_ENTRY_MAX, tagName, validateTagOperation } from './validation';
import type { Tag, TagRepository } from './types';
export class TagConflict extends Error {}
export function createD1TagRepository(db: ReviewDatabase): TagRepository {
  return {
    async list(userId) {
      return (
        await db
          .prepare(
            'SELECT id,name,normalized_name AS normalizedName,created_at AS createdAt,updated_at AS updatedAt FROM user_tags WHERE user_id=? ORDER BY normalized_name,id',
          )
          .bind(userId)
          .all<Tag>()
      ).results;
    },
    async apply(userId, input) {
      const op = validateTagOperation(input),
        now = new Date().toISOString();
      const touch = (id: string) =>
        db
          .prepare(
            'UPDATE user_dictionary_entries SET updated_at=? WHERE user_id=? AND id IN (SELECT entry_id FROM user_dictionary_tags WHERE user_id=? AND tag_id=?)',
          )
          .bind(now, userId, userId, id);
      if (op.action === 'delete') {
        await db.batch([
          touch(op.id),
          db.prepare('DELETE FROM user_tags WHERE user_id=? AND id=?').bind(userId, op.id),
        ]);
        return;
      }
      if (op.action === 'create' || op.action === 'rename') {
        const name = tagName(op.name);
        const duplicate = await db
          .prepare('SELECT id FROM user_tags WHERE user_id=? AND normalized_name=?')
          .bind(userId, name.normalizedName)
          .first<{ id: string }>();
        if (duplicate && duplicate.id !== op.id)
          throw new TagConflict('A tag with this name already exists.');
        try {
          if (op.action === 'create') {
            // Count and insert share one statement, so concurrent creates respect the limit.
            await db
              .prepare(
                `INSERT INTO user_tags(user_id,id,name,normalized_name,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE (SELECT count(*) FROM user_tags WHERE user_id=?) < ${TAG_ACCOUNT_MAX} ON CONFLICT(user_id,id) DO NOTHING`,
              )
              .bind(userId, op.id, name.name, name.normalizedName, now, now, userId)
              .run();
          } else {
            await db.batch([
              touch(op.id),
              db
                .prepare(
                  'UPDATE user_tags SET name=?,normalized_name=?,updated_at=? WHERE user_id=? AND id=?',
                )
                .bind(name.name, name.normalizedName, now, userId, op.id),
            ]);
          }
        } catch {
          throw new TagConflict('A tag with this name already exists.');
        }
        if (
          !(await db
            .prepare('SELECT id FROM user_tags WHERE user_id=? AND id=?')
            .bind(userId, op.id)
            .first())
        )
          throw new TagConflict(
            `Tag unavailable or limit reached (${TAG_ACCOUNT_MAX} per account).`,
          );
        return;
      }
      if (
        !(await db
          .prepare('SELECT id FROM user_tags WHERE user_id=? AND id=?')
          .bind(userId, op.tagId)
          .first())
      )
        throw new TagConflict('This tag is unavailable. Refresh your dictionary.');
      const found = await db
        .prepare(
          `SELECT id FROM user_dictionary_entries WHERE user_id=? AND id IN (${op.entryIds.map(() => '?').join(',')})`,
        )
        .bind(userId, ...op.entryIds)
        .all<{ id: string }>();
      if (found.results.length !== op.entryIds.length)
        throw new DictionaryValidationError('Invalid selected entries');
      try {
        await db.batch([
          op.remove
            ? db
                .prepare(
                  `DELETE FROM user_dictionary_tags WHERE user_id=? AND tag_id=? AND entry_id IN (${op.entryIds.map(() => '?').join(',')})`,
                )
                .bind(userId, op.tagId, ...op.entryIds)
            : // One bounded statement; NULL fails the whole batch if any entry exceeds its limit.
              db
                .prepare(
                  `WITH selected(entry_id) AS (VALUES ${op.entryIds.map(() => '(?)').join(',')}), owner(user_id,tag_id) AS (VALUES (?,?))
                INSERT INTO user_dictionary_tags(user_id,tag_id,entry_id)
                SELECT CASE WHEN (SELECT count(*) FROM user_dictionary_tags m WHERE m.user_id=owner.user_id AND m.entry_id=selected.entry_id) < ${TAG_ENTRY_MAX}
                  OR EXISTS(SELECT 1 FROM user_dictionary_tags m WHERE m.user_id=owner.user_id AND m.entry_id=selected.entry_id AND m.tag_id=owner.tag_id)
                  THEN owner.user_id ELSE NULL END,owner.tag_id,selected.entry_id FROM selected CROSS JOIN owner WHERE 1
                ON CONFLICT(user_id,tag_id,entry_id) DO NOTHING`,
                )
                .bind(...op.entryIds, userId, op.tagId),
          db
            .prepare(
              `UPDATE user_dictionary_entries SET updated_at=? WHERE user_id=? AND id IN (${op.entryIds.map(() => '?').join(',')})`,
            )
            .bind(now, userId, ...op.entryIds),
        ]);
      } catch {
        throw new TagConflict(
          `Each entry can have up to ${TAG_ENTRY_MAX} tags. Refresh if an entry was removed.`,
        );
      }
    },
  };
}
