-- Explicit learner-saved vocabulary. Unlike progress sync, these records intentionally retain
-- selected transcript context and safe replay locators because the learner chose to save them.
CREATE TABLE user_dictionary_entries (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1 CHECK(schema_version = 1),
  term TEXT NOT NULL,
  normalized_term TEXT NOT NULL,
  reading TEXT,
  translation TEXT NOT NULL,
  source_sentence TEXT NOT NULL,
  source_sentence_translation TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  segment_id TEXT NOT NULL,
  lesson_title TEXT NOT NULL,
  lesson_author TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('youtube','vimeo','direct','local','demo')),
  media_id TEXT,
  media_url TEXT,
  media_content_key TEXT,
  transcript_key TEXT NOT NULL,
  section_start REAL NOT NULL,
  section_end REAL NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id, id),
  UNIQUE(user_id, normalized_term, lesson_id, segment_id)
);
CREATE INDEX user_dictionary_recent
  ON user_dictionary_entries(user_id, created_at DESC);
CREATE INDEX user_dictionary_term
  ON user_dictionary_entries(user_id, normalized_term);
