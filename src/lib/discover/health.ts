import type { D1Database } from '../d1';

/**
 * Aggregate catalogue health, logged by each scheduled refresh. Counts only: no titles, learner
 * data or provider responses.
 */
export async function catalogueHealth(db: D1Database, now: number, quotaDay: string) {
  const since = new Date(now - 86400000).toISOString();
  const [totals, levels, topics, bands, channels, rejections, seeds, quota] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(v.caption_flag) AS captions_reported,
          SUM(EXISTS(SELECT 1 FROM linked_transcripts t WHERE t.content_key='youtube:'||v.video_id AND t.visibility='system'
            AND t.owner_user_id IS NULL AND t.source_type='provider-captions' AND t.language='ja')) AS prepared,
          SUM(v.language_evidence='reported-japanese-audio') AS reported_japanese_audio,
          SUM(v.orientation_hint='learner') AS learner, SUM(v.orientation_hint='native') AS native,
          COUNT(DISTINCT v.channel_id) AS channels, ROUND(AVG(v.quality_score)) AS mean_quality
        FROM discovery_videos v WHERE v.status='available'`,
      )
      .first<Record<string, number | null>>(),
    db
      .prepare(
        `SELECT j.value AS key, COUNT(*) AS n FROM discovery_videos v, json_each(v.level_targets_json) j GROUP BY j.value`,
      )
      .all<{ key: string; n: number }>(),
    db
      .prepare(
        `SELECT j.value AS key, COUNT(*) AS n FROM discovery_videos v, json_each(v.topic_keys_json) j GROUP BY j.value`,
      )
      .all<{ key: string; n: number }>(),
    db
      .prepare(
        `SELECT json_extract(a.payload_json,'$.overall.label') AS key, COUNT(*) AS n FROM discovery_video_state s
        JOIN generated_artifacts a ON a.id=s.difficulty_artifact_id WHERE s.analysis_verified_at IS NOT NULL GROUP BY 1`,
      )
      .all<{ key: string; n: number }>(),
    db
      .prepare(
        `SELECT COUNT(*) AS n FROM discovery_videos GROUP BY channel_id ORDER BY n DESC LIMIT 1`,
      )
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT reason AS key, COUNT(*) AS n FROM discovery_rejections WHERE rejected_at>=? GROUP BY reason`,
      )
      .bind(since)
      .all<{ key: string; n: number }>(),
    db
      .prepare(
        `SELECT seed_id AS key, SUM(returned) AS returned, SUM(accepted) AS accepted FROM discovery_seed_runs
        WHERE run_at>=? GROUP BY seed_id`,
      )
      .bind(since)
      .all<{ key: string; returned: number; accepted: number }>(),
    db
      .prepare('SELECT units FROM discovery_quota WHERE day=?')
      .bind(quotaDay)
      .first<{ units: number }>(),
  ]);
  const counts = (rows: { key: string; n: number }[]) =>
    Object.fromEntries(rows.map((r) => [r.key, r.n]));
  const total = totals?.total ?? 0;
  const acceptedLast24h = seeds.results.reduce((n, s) => n + s.accepted, 0);
  return {
    total,
    captionsReported: totals?.captions_reported ?? 0,
    prepared: totals?.prepared ?? 0,
    reportedJapaneseAudio: totals?.reported_japanese_audio ?? 0,
    orientation: { learner: totals?.learner ?? 0, native: totals?.native ?? 0 },
    channels: totals?.channels ?? 0,
    largestChannelShare: total ? Math.round(((channels?.n ?? 0) / total) * 100) / 100 : 0,
    meanQuality: totals?.mean_quality ?? null,
    levelTargets: counts(levels.results),
    topics: counts(topics.results),
    verifiedBands: counts(bands.results),
    rejections24h: counts(rejections.results),
    seedYield24h: Object.fromEntries(
      seeds.results.map((s) => [s.key, `${s.accepted}/${s.returned}`]),
    ),
    quotaUnitsToday: quota?.units ?? 0,
    acceptedLast24h,
    unitsPerAcceptedVideo: acceptedLast24h
      ? Math.round(((quota?.units ?? 0) / acceptedLast24h) * 10) / 10
      : null,
  };
}
