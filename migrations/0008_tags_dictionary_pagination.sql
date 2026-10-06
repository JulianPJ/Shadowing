-- Descriptive metadata only: tag deletion cannot own vocabulary or SRS.
CREATE TABLE user_tags (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 64),
  normalized_name TEXT NOT NULL CHECK(length(normalized_name) BETWEEN 1 AND 64),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,id),
  UNIQUE(user_id,normalized_name)
);
CREATE TABLE user_dictionary_tags (
  user_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  PRIMARY KEY(user_id,tag_id,entry_id),
  FOREIGN KEY(user_id,tag_id) REFERENCES user_tags(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,entry_id) REFERENCES user_dictionary_entries(user_id,id) ON DELETE CASCADE
);
CREATE INDEX user_dictionary_tags_entry ON user_dictionary_tags(user_id,entry_id);
-- Keyset ordering and exact lesson revision retrieval used by dictionary/recap/export.
DROP INDEX user_dictionary_recent;
CREATE INDEX user_dictionary_recent ON user_dictionary_entries(user_id,created_at DESC,id DESC);
CREATE INDEX user_dictionary_lesson ON user_dictionary_entries(user_id,lesson_id,transcript_key,created_at DESC,id DESC);
