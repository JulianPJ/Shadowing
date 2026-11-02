-- Learner sync pulls only the records written since a device's last sync instead of the whole
-- history on every sync. Every write stamps the server time. Existing rows take their update time,
-- which only devices that have not synced since this migration read (with a full pull).
ALTER TABLE user_lessons ADD COLUMN synced_at TEXT;
UPDATE user_lessons SET synced_at=updated_at;
CREATE INDEX user_lessons_synced ON user_lessons(user_id,synced_at,id);
ALTER TABLE user_practice_sessions ADD COLUMN synced_at TEXT;
UPDATE user_practice_sessions SET synced_at=updated_at;
CREATE INDEX user_practice_sessions_synced ON user_practice_sessions(user_id,synced_at,id);
ALTER TABLE user_quiz_attempts ADD COLUMN synced_at TEXT;
UPDATE user_quiz_attempts SET synced_at=updated_at;
CREATE INDEX user_quiz_attempts_synced ON user_quiz_attempts(user_id,synced_at,id);
ALTER TABLE user_bookmarks ADD COLUMN synced_at TEXT;
UPDATE user_bookmarks SET synced_at=updated_at;
CREATE INDEX user_bookmarks_synced ON user_bookmarks(user_id,synced_at,id);
ALTER TABLE user_difficulty_refs ADD COLUMN synced_at TEXT;
UPDATE user_difficulty_refs SET synced_at=updated_at;
CREATE INDEX user_difficulty_refs_synced ON user_difficulty_refs(user_id,synced_at,id);
ALTER TABLE user_practice_archives ADD COLUMN synced_at TEXT;
UPDATE user_practice_archives SET synced_at=updated_at;
CREATE INDEX user_practice_archives_synced ON user_practice_archives(user_id,synced_at,id);
