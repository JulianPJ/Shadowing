import { DIFFICULTY_GENERATOR_VERSION } from '../generated-artifacts';
import {
  BANDS,
  TOPICS,
  bandFromRange,
  canonicalUrl,
  validVideoId,
  type Database,
  type Video,
  type Topic,
} from './types';
function array(value: unknown): string[] {
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
function fromRow(row: Record<string, unknown>): Video | null {
  if (
    !validVideoId(row.video_id) ||
    typeof row.title !== 'string' ||
    !Number.isFinite(Date.parse(String(row.expires_at)))
  )
    return null;
  let band: Video['band'] = null,
    speed: number | null = null,
    proof: Video['proof'] = null;
  try {
    const analysis = JSON.parse(String(row.analysis_json));
    if (
      row.trusted &&
      row.analysis_verified_at &&
      row.generator_version === DIFFICULTY_GENERATOR_VERSION &&
      analysis.transcriptKey === row.transcript_key &&
      analysis.schemaVersion === 1 &&
      analysis.coverage?.strategyVersion === 2 &&
      analysis.coverage.totalSegments === analysis.coverage.sampledSegments &&
      analysis.coverage.totalCharacters === analysis.coverage.sampledCharacters
    ) {
      band = bandFromRange(analysis.overall.jlptMin, analysis.overall.jlptMax);
      if (
        band &&
        analysis.overall.label !== `Approximately ${BANDS.find((b) => b[0] === band)![1]}`
      )
        band = null;
      speed = [1, 2, 3, 4, 5].includes(analysis.speechSpeed?.level)
        ? analysis.speechSpeed.level
        : null;
      proof = {
        transcriptKey: String(row.transcript_key),
        generatorVersion: DIFFICULTY_GENERATOR_VERSION,
        verifiedAt: String(row.analysis_verified_at),
      };
    }
  } catch {
    /* Metadata-only videos are still useful. */
  }
  return {
    videoId: row.video_id,
    canonicalUrl: canonicalUrl(row.video_id),
    title: row.title,
    channelId: String(row.channel_id),
    channelTitle: String(row.channel_title),
    thumbnailUrl: typeof row.thumbnail_url === 'string' ? row.thumbnail_url : null,
    durationSeconds: Number(row.duration_seconds),
    description: String(row.description_excerpt),
    publishedAt: String(row.published_at),
    fetchedAt: String(row.fetched_at),
    expiresAt: String(row.expires_at),
    indexedAt: String(row.indexed_at),
    topics: array(row.topic_keys_json).filter((t): t is Topic => t in TOPICS),
    captionFlag: row.caption_flag === 1,
    embeddable: row.embeddable === 1,
    status: row.status === 'available' ? 'available' : 'unavailable',
    regionAllowed: array(row.region_allowed_json),
    regionBlocked: array(row.region_blocked_json),
    audience:
      row.audience_evidence && (row.audience === 'native' || row.audience === 'learner')
        ? row.audience
        : null,
    prepared: !!row.prepared,
    preparationStatus:
      row.preparation_status === 'needs-captions'
        ? 'needs-captions'
        : row.preparation_status === 'failed'
          ? 'failed'
          : row.preparation_status === 'prepared'
            ? 'prepared'
            : 'unknown',
    band,
    speed,
    proof,
    popularity: typeof row.popularity === 'number' ? row.popularity : null,
  };
}
/** A single bounded join. No captions, remote metadata or inference on feed reads. */
export async function readCatalog(db: Database, now = Date.now()): Promise<Video[]> {
  const rows = await db
    .prepare(
      `SELECT v.*, s.transcript_key, s.analysis_verified_at, s.audience, s.audience_evidence, s.preparation_status,
    a.payload_json AS analysis_json, a.generator_version,
    EXISTS(SELECT 1 FROM linked_transcripts t WHERE t.content_key='youtube:'||v.video_id AND t.transcript_hash=s.transcript_hash
      AND t.visibility='system' AND t.owner_user_id IS NULL AND t.source_type='provider-captions' AND t.language='ja'
      AND t.schema_version=1 AND t.normalization_version=1 AND t.segmentation_version=1) AS trusted,
    EXISTS(SELECT 1 FROM linked_transcripts t WHERE t.content_key='youtube:'||v.video_id AND t.visibility='system'
      AND t.owner_user_id IS NULL AND t.source_type='provider-captions' AND t.language='ja'
      AND t.schema_version=1 AND t.normalization_version=1 AND t.segmentation_version=1) AS prepared,
    (SELECT SUM(m.opens+m.completions*2+m.saves) FROM discovery_aggregate_metrics m WHERE m.video_id=v.video_id AND m.cohort>=10 AND m.day>=?) AS popularity
    FROM discovery_videos v LEFT JOIN discovery_video_state s ON s.video_id=v.video_id
    LEFT JOIN generated_artifacts a ON a.id=s.difficulty_artifact_id AND a.transcript_key=s.transcript_key
      AND a.source_transcript_hash=s.transcript_hash AND a.artifact_type='difficulty' AND a.schema_version=1
    WHERE v.status='available' AND v.expires_at>? AND (s.cooldown_until IS NULL OR s.cooldown_until<=?)
    ORDER BY v.indexed_at DESC,v.video_id LIMIT 1000`,
    )
    .bind(
      new Date(now - 7 * 86400000).toISOString().slice(0, 10),
      new Date(now).toISOString(),
      new Date(now).toISOString(),
    )
    .all<Record<string, unknown>>();
  return rows.results.map(fromRow).filter((v): v is Video => v !== null);
}
export async function saveVideos(db: Database, videos: Video[]) {
  if (!videos.length) return;
  await db.batch(
    videos.map((v) =>
      db
        .prepare(
          `INSERT INTO discovery_videos
    (video_id,canonical_url,title,channel_id,channel_title,thumbnail_url,duration_seconds,description_excerpt,published_at,caption_flag,embeddable,status,region_allowed_json,region_blocked_json,fetched_at,expires_at,indexed_at,topic_keys_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET
    title=excluded.title,channel_id=excluded.channel_id,channel_title=excluded.channel_title,thumbnail_url=excluded.thumbnail_url,
    duration_seconds=excluded.duration_seconds,description_excerpt=excluded.description_excerpt,published_at=excluded.published_at,
    caption_flag=excluded.caption_flag,embeddable=excluded.embeddable,status=excluded.status,region_allowed_json=excluded.region_allowed_json,
    region_blocked_json=excluded.region_blocked_json,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,
    topic_keys_json=(SELECT json_group_array(value) FROM (SELECT value FROM json_each(discovery_videos.topic_keys_json) UNION SELECT value FROM json_each(excluded.topic_keys_json)))`,
        )
        .bind(
          v.videoId,
          v.canonicalUrl,
          v.title,
          v.channelId,
          v.channelTitle,
          v.thumbnailUrl,
          v.durationSeconds,
          v.description,
          v.publishedAt,
          Number(v.captionFlag),
          Number(v.embeddable),
          v.status,
          JSON.stringify(v.regionAllowed),
          JSON.stringify(v.regionBlocked),
          v.fetchedAt,
          v.expiresAt,
          v.indexedAt,
          JSON.stringify(v.topics),
        ),
    ),
  );
}
