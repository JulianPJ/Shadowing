-- App-owned metadata only. Shared content cache tables are unchanged.
CREATE TABLE user_preferences (
  user_id TEXT PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  schema_version INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL CHECK(mode IN ('shadowing','continuous')),
  speed REAL NOT NULL, studio_mode INTEGER NOT NULL, furigana INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE user_lessons (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, lesson_id TEXT NOT NULL, transcript_key TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload_json TEXT NOT NULL,
  PRIMARY KEY(user_id,id), UNIQUE(user_id,lesson_id,transcript_key)
);
CREATE TABLE user_practice_sessions (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, lesson_id TEXT NOT NULL, transcript_key TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(user_id,id)
);
CREATE TABLE user_quiz_attempts (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, lesson_id TEXT NOT NULL, transcript_key TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(user_id,id)
);
CREATE TABLE user_bookmarks (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, lesson_id TEXT NOT NULL, transcript_key TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(user_id,id)
);
CREATE TABLE user_difficulty_refs (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, lesson_id TEXT NOT NULL, transcript_key TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(user_id,id)
);
-- Frozen anonymous retention summaries imported once per device/account.
CREATE TABLE user_practice_archives (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL, lesson_id TEXT NOT NULL, transcript_key TEXT NOT NULL,
  updated_at TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(user_id,id)
);
CREATE INDEX user_sessions_lesson ON user_practice_sessions(user_id,lesson_id,transcript_key);
CREATE INDEX user_attempts_lesson ON user_quiz_attempts(user_id,lesson_id,transcript_key);
CREATE INDEX user_bookmarks_lesson ON user_bookmarks(user_id,lesson_id,transcript_key);
