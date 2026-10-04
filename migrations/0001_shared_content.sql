CREATE TABLE linked_transcripts (
  storage_key TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK(schema_version = 1),
  content_key TEXT NOT NULL,
  media_type TEXT NOT NULL CHECK(media_type IN ('youtube','vimeo','direct')),
  provider TEXT,
  provider_media_id TEXT,
  language TEXT NOT NULL CHECK(language = 'ja'),
  transcript_hash TEXT NOT NULL,
  source_type TEXT NOT NULL,
  provenance TEXT NOT NULL,
  source_provider TEXT,
  visibility TEXT NOT NULL CHECK(visibility IN ('private','shared','system')),
  normalization_version INTEGER NOT NULL,
  segmentation_version INTEGER NOT NULL,
  cues_json TEXT NOT NULL,
  generator_version TEXT,
  model TEXT,
  owner_user_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX linked_transcripts_lookup ON linked_transcripts(content_key, language, created_at DESC, storage_key DESC);

CREATE TABLE generated_artifacts (
  id TEXT PRIMARY KEY,
  content_key TEXT NOT NULL,
  transcript_key TEXT NOT NULL,
  source_transcript_hash TEXT NOT NULL,
  artifact_type TEXT NOT NULL CHECK(artifact_type IN ('quiz','difficulty')),
  schema_version INTEGER NOT NULL,
  generator_version TEXT NOT NULL,
  payload_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(content_key, transcript_key, artifact_type, schema_version, generator_version)
);
