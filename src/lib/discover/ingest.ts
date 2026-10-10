import type { D1Database } from '../d1';
import { saveVideos, type AssessedVideo } from './catalog';
import { categoryTopic, type LevelTarget } from './acquisition';
import { QUALITY_VERSION, assessQuality, type QualityEvidence } from './quality';
import type { ProviderVideo } from './youtube-data-api';
import { validVideoId, type Topic } from './types';

/** Rejected IDs are skipped for 30 days, then may be reconsidered with fresh metadata. */
export const REJECTION_DAYS = 30;
const TRUSTED_TRANSCRIPT = `t.visibility='system' AND t.owner_user_id IS NULL AND t.source_type='provider-captions'
  AND t.language='ja' AND t.schema_version=1 AND t.normalization_version=1 AND t.segmentation_version=1`;
const placeholders = (n: number) => Array(n).fill('?').join(',');

export async function preparedVideoIds(db: D1Database, ids: string[]) {
  const result = new Set<string>();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db
      .prepare(
        `SELECT substr(t.content_key,9) AS id FROM linked_transcripts t
        WHERE t.content_key IN (${placeholders(chunk.length)}) AND ${TRUSTED_TRANSCRIPT}`,
      )
      .bind(...chunk.map((id) => `youtube:${id}`))
      .all<{ id: string }>();
    rows.results.forEach((r) => result.add(r.id));
  }
  return result;
}
/** Accepted, rejected and prepared counts for channels, from recent acquisition evidence only. */
export async function channelHistory(db: D1Database, channelIds: string[], now: number) {
  const history = new Map<string, NonNullable<QualityEvidence['channel']>>();
  const since = new Date(now - REJECTION_DAYS * 86400000).toISOString();
  const unique = [...new Set(channelIds)];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const list = placeholders(chunk.length);
    const [accepted, rejected, prepared] = await Promise.all([
      db
        .prepare(
          `SELECT channel_id, COUNT(*) AS n FROM discovery_videos WHERE channel_id IN (${list}) GROUP BY channel_id`,
        )
        .bind(...chunk)
        .all<{ channel_id: string; n: number }>(),
      db
        .prepare(
          `SELECT channel_id, COUNT(*) AS n FROM discovery_rejections WHERE channel_id IN (${list}) AND rejected_at>=? GROUP BY channel_id`,
        )
        .bind(...chunk, since)
        .all<{ channel_id: string; n: number }>(),
      db
        .prepare(
          `SELECT v.channel_id, COUNT(*) AS n FROM discovery_videos v JOIN linked_transcripts t ON t.content_key='youtube:'||v.video_id
          WHERE v.channel_id IN (${list}) AND ${TRUSTED_TRANSCRIPT} GROUP BY v.channel_id`,
        )
        .bind(...chunk)
        .all<{ channel_id: string; n: number }>(),
    ]);
    const entry = (id: string) => {
      if (!history.has(id)) history.set(id, { accepted: 0, rejected: 0, prepared: 0 });
      return history.get(id)!;
    };
    accepted.results.forEach((r) => (entry(r.channel_id).accepted = r.n));
    rejected.results.forEach((r) => (entry(r.channel_id).rejected = r.n));
    prepared.results.forEach((r) => (entry(r.channel_id).prepared = r.n));
  }
  return history;
}
export async function recentlyRejected(db: D1Database, ids: string[], now: number) {
  const result = new Set<string>();
  const since = new Date(now - REJECTION_DAYS * 86400000).toISOString();
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const rows = await db
      .prepare(
        `SELECT video_id FROM discovery_rejections WHERE video_id IN (${placeholders(chunk.length)}) AND rejected_at>=?`,
      )
      .bind(...chunk, since)
      .all<{ video_id: string }>();
    rows.results.forEach((r) => result.add(r.video_id));
  }
  return result;
}
export type IngestResult = { accepted: number; rejected: number; reasons: Record<string, number> };
/**
 * Assess provider results and keep only likely spoken-Japanese shadowing material. Requested IDs
 * that the provider no longer returns (private, deleted, unembeddable) are recorded as unavailable.
 */
export async function ingestVideos(
  db: D1Database,
  requested: string[],
  videos: ProviderVideo[],
  now: number,
  seed?: { id: string; levelTarget: LevelTarget | null },
): Promise<IngestResult> {
  const time = new Date(now).toISOString();
  const [prepared, channels] = await Promise.all([
    preparedVideoIds(
      db,
      videos.map((v) => v.videoId),
    ),
    channelHistory(
      db,
      videos.map((v) => v.channelId),
      now,
    ),
  ]);
  const accepted: AssessedVideo[] = [];
  const rejected: { videoId: string; channelId: string | null; reason: string }[] = [];
  for (const { signals, ...video } of videos) {
    const quality = assessQuality(
      { ...video, ...signals, description: signals.fullDescription || video.description },
      { prepared: prepared.has(video.videoId), channel: channels.get(video.channelId) },
    );
    if (!quality.accepted) {
      rejected.push({
        videoId: video.videoId,
        channelId: video.channelId,
        reason: quality.rejection!,
      });
      continue;
    }
    const derived = categoryTopic(signals.categoryId);
    const topics: Topic[] =
      derived && !video.topics.includes(derived) ? [...video.topics, derived] : video.topics;
    accepted.push({
      ...video,
      topics,
      levelTargets: seed?.levelTarget ? [seed.levelTarget] : [],
      assessment: {
        quality,
        defaultAudioLanguage: signals.defaultAudioLanguage,
        defaultLanguage: signals.defaultLanguage,
        categoryId: signals.categoryId,
      },
    });
  }
  const returned = new Set(videos.map((v) => v.videoId));
  for (const id of requested)
    if (!returned.has(id)) rejected.push({ videoId: id, channelId: null, reason: 'unavailable' });
  await saveVideos(db, accepted);
  if (rejected.length)
    await db.batch(
      rejected.flatMap((r) => [
        db.prepare('DELETE FROM discovery_videos WHERE video_id=?').bind(r.videoId),
        db
          .prepare(
            `INSERT INTO discovery_rejections(video_id,channel_id,reason,seed_id,rejected_at) VALUES(?,?,?,?,?)
            ON CONFLICT(video_id) DO UPDATE SET channel_id=COALESCE(excluded.channel_id,discovery_rejections.channel_id),
            reason=excluded.reason,seed_id=excluded.seed_id,rejected_at=excluded.rejected_at`,
          )
          .bind(r.videoId, r.channelId, r.reason, seed?.id ?? null, time),
      ]),
    );
  const reasons: Record<string, number> = {};
  rejected.forEach((r) => (reasons[r.reason] = (reasons[r.reason] ?? 0) + 1));
  return { accepted: accepted.length, rejected: rejected.length, reasons };
}
/**
 * Re-assess stored rows whose quality version is missing or outdated, using stored metadata only.
 * This cleans an existing catalogue without spending provider quota.
 */
export async function reassessCatalogue(db: D1Database, now: number, limit = 100) {
  const rows = await db
    .prepare(
      `SELECT video_id,title,description_excerpt,channel_id,channel_title,duration_seconds,caption_flag,
        default_audio_language,default_language,category_id FROM discovery_videos
      WHERE quality_version IS NULL OR quality_version<? ORDER BY video_id LIMIT ?`,
    )
    .bind(QUALITY_VERSION, limit)
    .all<{
      video_id: string;
      title: string;
      description_excerpt: string;
      channel_id: string;
      channel_title: string;
      duration_seconds: number;
      caption_flag: number;
      default_audio_language: string | null;
      default_language: string | null;
      category_id: string | null;
    }>();
  if (!rows.results.length) return { reassessed: 0, removed: 0 };
  const [prepared, channels] = await Promise.all([
    preparedVideoIds(
      db,
      rows.results.map((r) => r.video_id),
    ),
    channelHistory(
      db,
      rows.results.map((r) => r.channel_id),
      now,
    ),
  ]);
  const time = new Date(now).toISOString();
  let removed = 0;
  const statements = rows.results.flatMap((row) => {
    const quality = assessQuality(
      {
        title: row.title,
        description: row.description_excerpt,
        channelTitle: row.channel_title,
        durationSeconds: row.duration_seconds,
        captionFlag: row.caption_flag === 1,
        defaultAudioLanguage: row.default_audio_language,
        defaultLanguage: row.default_language,
        categoryId: row.category_id,
      },
      { prepared: prepared.has(row.video_id), channel: channels.get(row.channel_id) },
    );
    if (!quality.accepted) {
      removed++;
      return [
        db.prepare('DELETE FROM discovery_videos WHERE video_id=?').bind(row.video_id),
        db
          .prepare(
            `INSERT INTO discovery_rejections(video_id,channel_id,reason,seed_id,rejected_at) VALUES(?,?,?,NULL,?)
            ON CONFLICT(video_id) DO UPDATE SET reason=excluded.reason,rejected_at=excluded.rejected_at`,
          )
          .bind(row.video_id, row.channel_id, quality.rejection!, time),
      ];
    }
    return [
      db
        .prepare(
          `UPDATE discovery_videos SET quality_score=?,quality_version=?,quality_reasons_json=?,language_evidence=?,
          orientation_hint=?,orientation_evidence=? WHERE video_id=?`,
        )
        .bind(
          quality.score,
          QUALITY_VERSION,
          JSON.stringify(quality.reasons),
          quality.languageEvidence,
          quality.orientation,
          quality.orientationEvidence,
          row.video_id,
        ),
    ];
  });
  await db.batch(statements);
  return { reassessed: rows.results.length, removed };
}
/**
 * Videos already prepared in Hibiki from trusted public Japanese captions, but missing from the
 * catalogue. Adding them costs one metadata unit per 50 and gives Discover verifiable levels.
 */
export async function preparedBackfillIds(db: D1Database, now: number, limit = 50) {
  const rows = await db
    .prepare(
      `SELECT DISTINCT substr(t.content_key,9) AS id FROM linked_transcripts t
      WHERE t.content_key LIKE 'youtube:%' AND length(t.content_key)=19 AND ${TRUSTED_TRANSCRIPT}
      AND NOT EXISTS(SELECT 1 FROM discovery_videos v WHERE 'youtube:'||v.video_id=t.content_key)
      AND NOT EXISTS(SELECT 1 FROM discovery_rejections r WHERE 'youtube:'||r.video_id=t.content_key AND r.rejected_at>=?)
      ORDER BY t.content_key LIMIT ?`,
    )
    .bind(new Date(now - REJECTION_DAYS * 86400000).toISOString(), limit)
    .all<{ id: string }>();
  return rows.results.map((r) => r.id).filter(validVideoId);
}
