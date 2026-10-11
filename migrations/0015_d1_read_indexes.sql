-- Every 15-minute Discover run looks up channel history for each ingested batch and stale quality
-- versions. Without these indexes each lookup scanned the whole catalogue.
CREATE INDEX discovery_videos_channel ON discovery_videos(channel_id);
CREATE INDEX discovery_videos_quality ON discovery_videos(quality_version);
-- The same runs purge old feedback and removed Watch Later records. Both purges scanned their table.
CREATE INDEX discovery_feedback_created ON discovery_feedback(created_at);
CREATE INDEX user_watch_later_removed ON user_watch_later(updated_at) WHERE removed=1;
-- UNIQUE(user_id,normalized_term,lesson_id,segment_id) already serves (user_id,normalized_term)
-- lookups. The duplicate only cost an extra written row per dictionary change.
DROP INDEX user_dictionary_term;
