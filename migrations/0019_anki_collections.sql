-- Additive source metadata. Legacy deck operations remain no-ops.
ALTER TABLE user_dictionary_entries ADD COLUMN import_source TEXT;
CREATE TABLE user_vocabulary_collections (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 id TEXT NOT NULL, name TEXT NOT NULL,
 PRIMARY KEY(user_id,id)
);
CREATE INDEX user_vocabulary_collection_names ON user_vocabulary_collections(user_id,name);
CREATE TABLE user_vocabulary_memberships (
 user_id TEXT NOT NULL, collection_id TEXT NOT NULL, entry_id TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,collection_id,entry_id),
 FOREIGN KEY(user_id,collection_id) REFERENCES user_vocabulary_collections(user_id,id) ON DELETE CASCADE,
 FOREIGN KEY(user_id,entry_id) REFERENCES user_dictionary_entries(user_id,id) ON DELETE CASCADE
);
CREATE INDEX user_vocabulary_membership_page ON user_vocabulary_memberships(user_id,collection_id,created_at DESC,entry_id DESC);
-- Stable content identity survives package re-export, note/card ordering and retries.
CREATE TABLE user_vocabulary_import_keys (
 user_id TEXT NOT NULL, content_key TEXT NOT NULL, entry_id TEXT NOT NULL, entry_created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,content_key),
 FOREIGN KEY(user_id,entry_id) REFERENCES user_dictionary_entries(user_id,id) ON DELETE CASCADE
);
-- Import quota only, never dashboard analytics.
CREATE TABLE user_vocabulary_import_usage (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
 day TEXT NOT NULL, contexts INTEGER NOT NULL,
 PRIMARY KEY(user_id,day)
);
