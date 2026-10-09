-- Server-assigned change time for incremental word-state pulls.
-- Client updated_at stays the last-writer-wins clock, while synced_at only answers
-- "what changed on the server since my last pull". Existing rows have no value and are
-- returned by the first full pull on each device.
ALTER TABLE user_word_knowledge ADD COLUMN synced_at TEXT;
CREATE INDEX user_word_knowledge_synced ON user_word_knowledge(user_id, synced_at);
