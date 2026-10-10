-- Isolated retry state for scheduled Discover content enrichment.
-- Retains observations across metadata refreshes and is purged by FK on expiry.
CREATE TABLE discovery_enrichment_attempts (
  video_id TEXT PRIMARY KEY REFERENCES discovery_videos(video_id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TEXT NOT NULL,
  next_attempt_at TEXT,
  last_result TEXT NOT NULL
);
CREATE INDEX discovery_enrichment_due ON discovery_enrichment_attempts(next_attempt_at);