-- Values the scheduled Discover jobs reuse between runs instead of re-reading the catalogue:
-- seed-choice coverage (recomputed hourly) and the published feed snapshot's revision.
CREATE TABLE discovery_job_state (
 key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
-- (day, video) pairs that received engagement since the last metrics roll-up. The roll-up
-- recomputes only these pairs instead of rescanning seven days of events every run.
CREATE TABLE discovery_metric_dirty (
 day TEXT NOT NULL, video_id TEXT NOT NULL, PRIMARY KEY(day,video_id)
) WITHOUT ROWID;
INSERT OR IGNORE INTO discovery_metric_dirty(day,video_id)
 SELECT DISTINCT day,video_id FROM discovery_metric_events
 WHERE action<>'impression' AND day>=date('now','-7 days');
-- Videos awaiting verification (new state rows and fresh preparations) are found between the
-- hourly verification sweeps without reading every hosted transcript.
CREATE INDEX discovery_video_state_unchecked ON discovery_video_state(video_id)
 WHERE last_catalog_check_at IS NULL;
-- Nightly analysis reads candidates in priority order and stops at the first 200 instead of
-- sorting the whole catalogue on each of its 16 runs.
CREATE INDEX discovery_videos_analysis
 ON discovery_videos(caption_flag DESC, COALESCE(quality_score,0) DESC, video_id)
 WHERE status='available' AND embeddable=1;
