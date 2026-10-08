-- Account-owned accepted ratings support shared daily study counts.
-- Keep entry references after word deletion so deleting vocabulary cannot reset a day's allowance.
CREATE TABLE user_review_events (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  operation_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  grade TEXT NOT NULL CHECK(grade IN ('again','hard','good','easy')),
  status TEXT NOT NULL CHECK(status IN ('new','learning','review')),
  reviewed_at TEXT NOT NULL,
  PRIMARY KEY(user_id,operation_id)
);
CREATE INDEX user_review_events_recent ON user_review_events(user_id,reviewed_at DESC,operation_id);
-- Older device-only ratings are outside the authoritative replacement window.
CREATE TABLE review_event_metadata (
  id INTEGER PRIMARY KEY CHECK(id=1),
  first_recorded_at TEXT NOT NULL
);
INSERT INTO review_event_metadata(id,first_recorded_at) VALUES (1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
