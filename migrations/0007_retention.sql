-- Collections reference stable vocabulary. Removing a deck never deletes words or schedules.
CREATE TABLE user_decks (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,id)
);
CREATE TABLE user_deck_entries (
  user_id TEXT NOT NULL,
  deck_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  PRIMARY KEY(user_id,deck_id,entry_id),
  FOREIGN KEY(user_id,deck_id) REFERENCES user_decks(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY(user_id,entry_id) REFERENCES user_dictionary_entries(user_id,id) ON DELETE CASCADE
);
CREATE INDEX user_deck_entry_lookup ON user_deck_entries(user_id,entry_id);
CREATE TABLE user_review_states (
  user_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK(schema_version=1),
  algorithm TEXT NOT NULL CHECK(algorithm='sm2-v1'),
  status TEXT NOT NULL CHECK(status IN ('new','learning','review','suspended')),
  due_at TEXT NOT NULL,
  last_reviewed_at TEXT,
  interval_days REAL NOT NULL CHECK(interval_days>=0),
  ease REAL NOT NULL CHECK(ease>=1.3),
  repetitions INTEGER NOT NULL CHECK(repetitions>=0),
  lapses INTEGER NOT NULL CHECK(lapses>=0),
  revision INTEGER NOT NULL CHECK(revision>=0),
  last_operation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(user_id,entry_id),
  FOREIGN KEY(user_id,entry_id) REFERENCES user_dictionary_entries(user_id,id) ON DELETE CASCADE
);
CREATE INDEX user_review_due ON user_review_states(user_id,status,due_at);
-- Existing words go to Inbox but never enter review without explicit selection.
INSERT INTO user_decks SELECT DISTINCT user_id,'inbox','Inbox',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM user_dictionary_entries;
INSERT INTO user_deck_entries SELECT user_id,'inbox',id FROM user_dictionary_entries;
