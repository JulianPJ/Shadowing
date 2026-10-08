CREATE TABLE discovery_videos (
  video_id TEXT PRIMARY KEY CHECK(length(video_id)=11), canonical_url TEXT NOT NULL,
  title TEXT NOT NULL, channel_id TEXT NOT NULL, channel_title TEXT NOT NULL,
  thumbnail_url TEXT, duration_seconds INTEGER NOT NULL CHECK(duration_seconds>0),
  description_excerpt TEXT NOT NULL DEFAULT '', published_at TEXT NOT NULL,
  caption_flag INTEGER NOT NULL CHECK(caption_flag IN (0,1)), embeddable INTEGER NOT NULL CHECK(embeddable IN (0,1)),
  status TEXT NOT NULL CHECK(status IN ('available','unavailable')),
  region_allowed_json TEXT NOT NULL DEFAULT '[]', region_blocked_json TEXT NOT NULL DEFAULT '[]',
  fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL, indexed_at TEXT NOT NULL,
  topic_keys_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX discovery_videos_fresh ON discovery_videos(status,expires_at,published_at DESC,video_id);
CREATE INDEX discovery_videos_refresh ON discovery_videos(fetched_at,video_id);
CREATE INDEX discovery_videos_indexed ON discovery_videos(indexed_at DESC,video_id);
CREATE TABLE discovery_seed_queries (
  id TEXT PRIMARY KEY, topic TEXT NOT NULL, query TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT, next_run_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z'
);
CREATE INDEX discovery_seed_due ON discovery_seed_queries(enabled,next_run_at);
INSERT INTO discovery_seed_queries(id,topic,query) VALUES
 ('everyday','everyday','日本語 日常生活'), ('vlogs','vlogs','日本語 日常 vlog'),
 ('conversations','conversations','日本語 ゆっくり 会話'), ('food','food','日本語 料理 食べ歩き'),
 ('travel','travel','日本語 日本 旅行'), ('entertainment','entertainment','日本語 エンタメ'),
 ('gaming','gaming','日本語 ゲーム 実況'), ('news','news','日本語 ニュース'), ('education','education','日本語 学び 解説');
CREATE TABLE discovery_video_state (
 video_id TEXT PRIMARY KEY, preparation_status TEXT NOT NULL DEFAULT 'unknown', last_prepared_at TEXT,
 last_failure_code TEXT, cooldown_until TEXT, last_catalog_check_at TEXT,
 difficulty_artifact_id TEXT, transcript_key TEXT, transcript_hash TEXT, analysis_verified_at TEXT,
 audience TEXT CHECK(audience IN ('learner','native')), audience_evidence TEXT,
 FOREIGN KEY(video_id) REFERENCES discovery_videos(video_id) ON DELETE CASCADE
);
CREATE TABLE user_discovery_preferences (
 user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE, preferences_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE user_watch_later (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, video_id TEXT NOT NULL,
 canonical_url TEXT NOT NULL, title TEXT NOT NULL, position REAL NOT NULL, added_at TEXT NOT NULL,
 updated_at TEXT NOT NULL, removed INTEGER NOT NULL DEFAULT 0 CHECK(removed IN (0,1)),
 PRIMARY KEY(user_id,video_id)
);
CREATE INDEX user_watch_later_order ON user_watch_later(user_id,removed,position,video_id);
CREATE TABLE discovery_feedback (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, video_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('not_interested','more_like_this','reset')), created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,video_id)
);
CREATE TABLE discovery_metric_events (
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, day TEXT NOT NULL, video_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('impression','open','prepared','complete','save')),
 PRIMARY KEY(user_id,day,video_id,action)
);
CREATE INDEX discovery_metric_day ON discovery_metric_events(day,video_id);
CREATE TABLE discovery_aggregate_metrics (
 day TEXT NOT NULL, video_id TEXT NOT NULL, cohort INTEGER NOT NULL,
 impressions INTEGER NOT NULL, opens INTEGER NOT NULL, successful_prepares INTEGER NOT NULL,
 completions INTEGER NOT NULL, saves INTEGER NOT NULL, PRIMARY KEY(day,video_id)
);
CREATE INDEX discovery_aggregate_video ON discovery_aggregate_metrics(video_id,day);
CREATE TABLE discovery_jobs (id TEXT PRIMARY KEY, lease_until TEXT NOT NULL);
CREATE TABLE discovery_quota (day TEXT PRIMARY KEY, units INTEGER NOT NULL);
