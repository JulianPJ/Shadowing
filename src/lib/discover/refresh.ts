import type { D1Database } from '../d1';
import { storageEvent } from '../d1';
import { createD1LinkedTranscriptRepository } from '../linked-transcripts';
import {
  createD1GeneratedArtifactRepository,
  DIFFICULTY_GENERATOR_VERSION,
} from '../generated-artifacts';
import { segmentTranscript } from '../segmentation';
import { transcriptKey } from '../transcript';
import { validateDifficultyAnalysis } from '../difficulty';
import { TOPICS, type Topic } from './types';
import { saveVideos } from './catalog';
import { youtubeDataApi, YoutubeDataError } from './youtube-data-api';

// Conservative internal weights: a search costs 100 points, a metadata batch costs one.
// This also keeps searches below Google's separate default 100-search/day allowance.
export const DISCOVER_DAILY_BUDGET = 9000;
const quotaClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
export function youtubeQuotaWindow(now: number) {
  const parts = Object.fromEntries(quotaClock.formatToParts(now).map((p) => [p.type, p.value]));
  const minute = Number(parts.hour) * 60 + Number(parts.minute);
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    // Release budget gradually; an outage can catch up in later bounded executions.
    // Local-clock pacing tolerates DST's skipped/repeated hour; the daily cap stays strict.
    searchLimit: Math.min(
      DISCOVER_DAILY_BUDGET - 1,
      Math.floor(((minute + 15) / 1440) * DISCOVER_DAILY_BUDGET),
    ),
  };
}
/** Only scheduled execution calls this. Existing validated artifacts are reused without inference. */
export async function verifyAnalyses(db: D1Database, now = Date.now()) {
  const rows = await db
    .prepare(
      `SELECT v.video_id FROM discovery_videos v LEFT JOIN discovery_video_state s ON s.video_id=v.video_id
    WHERE s.last_catalog_check_at IS NULL OR s.last_catalog_check_at<? ORDER BY s.last_catalog_check_at,v.video_id LIMIT 100`,
    )
    .bind(new Date(now - 3600000).toISOString())
    .all<{ video_id: string }>();
  const transcripts = createD1LinkedTranscriptRepository(db),
    artifacts = createD1GeneratedArtifactRepository(db);
  for (const { video_id: id } of rows.results) {
    let artifactId: string | null = null,
      key: string | null = null,
      hash: string | null = null;
    const stored = await transcripts.lookup({ contentKey: `youtube:${id}`, language: 'ja' });
    if (
      stored &&
      stored.visibility === 'system' &&
      stored.ownerId == null &&
      stored.source.type === 'provider-captions'
    ) {
      const lesson = { id: `youtube-${id}`, segments: segmentTranscript(stored.cues) };
      key = await transcriptKey(lesson);
      hash = stored.transcriptHash;
      const artifact = await artifacts.lookup({
        contentKey: stored.contentKey,
        transcriptKey: key,
        artifactType: 'difficulty',
        schemaVersion: 1,
        generatorVersion: DIFFICULTY_GENERATOR_VERSION,
      });
      if (artifact && artifact.sourceTranscriptHash === hash) {
        try {
          await validateDifficultyAnalysis(artifact.payload, lesson);
          const row = await db
            .prepare(
              `SELECT id FROM generated_artifacts WHERE content_key=? AND transcript_key=? AND source_transcript_hash=? AND artifact_type='difficulty' AND schema_version=1 AND generator_version=?`,
            )
            .bind(stored.contentKey, key, hash, DIFFICULTY_GENERATOR_VERSION)
            .first<{ id: string }>();
          artifactId = row?.id ?? null;
        } catch {
          /* Invalid estimates remain unknown. */
        }
      }
    }
    await db
      .prepare(
        `INSERT INTO discovery_video_state(video_id,last_catalog_check_at,difficulty_artifact_id,transcript_key,transcript_hash,analysis_verified_at)
      VALUES(?,?,?,?,?,?) ON CONFLICT(video_id) DO UPDATE SET last_catalog_check_at=excluded.last_catalog_check_at,difficulty_artifact_id=excluded.difficulty_artifact_id,
      transcript_key=excluded.transcript_key,transcript_hash=excluded.transcript_hash,analysis_verified_at=excluded.analysis_verified_at`,
      )
      .bind(
        id,
        new Date(now).toISOString(),
        artifactId,
        key,
        hash,
        artifactId ? new Date(now).toISOString() : null,
      )
      .run();
  }
}
export async function refreshCatalog(
  db: D1Database,
  apiKey?: string,
  fetchImpl: typeof fetch = fetch,
  now = Date.now(),
) {
  const time = new Date(now).toISOString(),
    lease = new Date(now + 15 * 60000).toISOString();
  const acquired = await db
    .prepare(
      `INSERT INTO discovery_jobs(id,lease_until) VALUES('catalogue',?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE discovery_jobs.lease_until<? RETURNING id`,
    )
    .bind(lease, time)
    .first();
  if (!acquired) return;
  let searches = 0,
    refreshed = 0;
  try {
    // Expired public API metadata is deleted even when the key is missing or quota exhausted.
    await db.batch([
      db.prepare('DELETE FROM discovery_videos WHERE expires_at<=?').bind(time),
      db
        .prepare('DELETE FROM discovery_metric_events WHERE day<?')
        .bind(new Date(now - 30 * 86400000).toISOString().slice(0, 10)),
      db
        .prepare('DELETE FROM discovery_aggregate_metrics WHERE day<?')
        .bind(new Date(now - 30 * 86400000).toISOString().slice(0, 10)),
      db
        .prepare('DELETE FROM discovery_feedback WHERE created_at<?')
        .bind(new Date(now - 180 * 86400000).toISOString()),
      db
        .prepare('DELETE FROM user_watch_later WHERE removed=1 AND updated_at<?')
        .bind(new Date(now - 180 * 86400000).toISOString()),
      db
        .prepare('DELETE FROM discovery_quota WHERE day<?')
        .bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10)),
    ]);
    try {
      if (apiKey) {
        const { day, searchLimit } = youtubeQuotaWindow(now);
        const api = youtubeDataApi(apiKey, fetchImpl, async (units) => {
          // Searches leave at least one point to validate their results. Stale metadata
          // can use the full daily allowance independently of search pacing.
          const limit = units === 100 ? searchLimit : DISCOVER_DAILY_BUDGET;
          return !!(await db
            .prepare(
              `INSERT INTO discovery_quota(day,units) SELECT ?,? WHERE ?<=?
                ON CONFLICT(day) DO UPDATE SET units=discovery_quota.units+excluded.units
                WHERE discovery_quota.units+excluded.units<=? RETURNING day`,
            )
            .bind(day, units, units, limit, limit)
            .first());
        });
        // Refresh stale metadata independently of discovery. Two 50-ID batches per invocation.
        const stale = await db
          .prepare(
            'SELECT video_id FROM discovery_videos WHERE fetched_at<? ORDER BY fetched_at LIMIT 100',
          )
          .bind(new Date(now - 86400000).toISOString())
          .all<{ video_id: string }>();
        for (let i = 0; i < stale.results.length; i += 50) {
          const ids = stale.results.slice(i, i + 50).map((v) => v.video_id),
            videos = await api.videos(ids, [], now);
          await saveVideos(db, videos);
          refreshed += videos.length;
          const valid = new Set(videos.map((v) => v.videoId));
          const unavailable = ids.filter((id) => !valid.has(id));
          if (unavailable.length)
            await db.batch(
              unavailable.map((id) =>
                db.prepare('DELETE FROM discovery_videos WHERE video_id=?').bind(id),
              ),
            );
        }
        const seeds = await db
          .prepare(
            `SELECT id,topic,query FROM discovery_seed_queries WHERE enabled=1
            AND (next_run_at<=? OR (last_run_at IS NOT NULL AND last_run_at<=?))
            ORDER BY COALESCE(last_run_at,'1970-01-01T00:00:00.000Z'),id LIMIT 2`,
          )
          .bind(time, new Date(now - 3600000).toISOString())
          .all<{ id: string; topic: Topic; query: string }>();
        for (const seed of seeds.results) {
          if (!(seed.topic in TOPICS)) continue;
          const order = (['relevance', 'date', 'viewCount'] as const)[
            Math.floor(now / 3600000) % 3
          ];
          const ids = await api.search(seed.query, order);
          searches++;
          await saveVideos(db, await api.videos(ids, [seed.topic], now));
          await db
            .prepare('UPDATE discovery_seed_queries SET last_run_at=?,next_run_at=? WHERE id=?')
            .bind(time, new Date(now + 3600000).toISOString(), seed.id)
            .run();
        }
      }
    } catch (error) {
      storageEvent(
        error instanceof YoutubeDataError
          ? `discover.refresh.${error.code}`
          : 'discover.refresh.provider_unavailable',
      );
    }
    // An upstream outage/quota limit must not stop independent analysis reuse or metrics.
    await verifyAnalyses(db, now);
    // Minimum ten distinct authenticated learners, unique events per learner/day/video/action.
    await db
      .prepare(
        `INSERT INTO discovery_aggregate_metrics(day,video_id,cohort,impressions,opens,successful_prepares,completions,saves)
      SELECT day,video_id,COUNT(DISTINCT user_id),SUM(action='impression'),SUM(action='open'),SUM(action='prepared'),SUM(action='complete'),SUM(action='save')
      FROM discovery_metric_events WHERE day>=? GROUP BY day,video_id HAVING COUNT(DISTINCT user_id)>=10
      ON CONFLICT(day,video_id) DO UPDATE SET cohort=excluded.cohort,impressions=excluded.impressions,opens=excluded.opens,successful_prepares=excluded.successful_prepares,completions=excluded.completions,saves=excluded.saves`,
      )
      .bind(new Date(now - 7 * 86400000).toISOString().slice(0, 10))
      .run();
    console.info(
      JSON.stringify({ event: 'discover.refresh', searches, refreshed, keyConfigured: !!apiKey }),
    );
  } catch (error) {
    storageEvent(
      error instanceof YoutubeDataError
        ? `discover.refresh.${error.code}`
        : 'discover.refresh.unavailable',
    );
  } finally {
    await db
      .prepare("DELETE FROM discovery_jobs WHERE id='catalogue' AND lease_until=?")
      .bind(lease)
      .run();
  }
}
