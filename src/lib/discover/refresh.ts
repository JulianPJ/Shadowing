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
import { youtubeDataApi, YoutubeDataError } from './youtube-data-api';
import {
  LEVEL_TARGETS,
  chooseSeeds,
  seedCooldown,
  seedOrder,
  type Coverage,
  type LevelTarget,
  type Seed,
} from './acquisition';
import {
  REJECTION_DAYS,
  ingestVideos,
  preparedBackfillIds,
  reassessCatalogue,
  recentlyRejected,
} from './ingest';
import { catalogueHealth } from './health';

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
// Seeds whose schedule lies beyond the longest adaptive cooldown are treated as legacy and due.
const MAX_COOLDOWN = 13 * 3600000;
async function dueSeeds(db: D1Database, now: number): Promise<Seed[]> {
  const rows = await db
    .prepare(
      `SELECT id,topic,query,level_target,orientation,runs,returned,accepted,last_run_at FROM discovery_seed_queries
      WHERE enabled=1 AND (next_run_at<=? OR next_run_at>?)`,
    )
    .bind(new Date(now).toISOString(), new Date(now + MAX_COOLDOWN).toISOString())
    .all<{
      id: string;
      topic: string;
      query: string;
      level_target: string | null;
      orientation: string | null;
      runs: number;
      returned: number;
      accepted: number;
      last_run_at: string | null;
    }>();
  return rows.results
    .filter((r) => r.topic in TOPICS)
    .map((r) => ({
      id: r.id,
      topic: r.topic as Topic,
      query: r.query,
      levelTarget: (LEVEL_TARGETS as readonly string[]).includes(r.level_target ?? '')
        ? (r.level_target as LevelTarget)
        : null,
      orientation: r.orientation === 'learner' || r.orientation === 'native' ? r.orientation : null,
      runs: r.runs,
      returned: r.returned,
      accepted: r.accepted,
      lastRunAt: r.last_run_at,
    }));
}
async function catalogueCoverage(db: D1Database): Promise<Coverage> {
  const [total, levels, topics] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM discovery_videos').first<{ n: number }>(),
    db
      .prepare(
        'SELECT j.value AS key, COUNT(*) AS n FROM discovery_videos v, json_each(v.level_targets_json) j GROUP BY j.value',
      )
      .all<{ key: LevelTarget; n: number }>(),
    db
      .prepare(
        'SELECT j.value AS key, COUNT(*) AS n FROM discovery_videos v, json_each(v.topic_keys_json) j GROUP BY j.value',
      )
      .all<{ key: Topic; n: number }>(),
  ]);
  return {
    total: total?.n ?? 0,
    levels: Object.fromEntries(levels.results.map((r) => [r.key, r.n])),
    topics: Object.fromEntries(topics.results.map((r) => [r.key, r.n])),
  };
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
    refreshed = 0,
    accepted = 0,
    rejected = 0,
    backfilled = 0;
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
      db
        .prepare('DELETE FROM discovery_rejections WHERE rejected_at<?')
        .bind(new Date(now - REJECTION_DAYS * 86400000).toISOString()),
      db
        .prepare('DELETE FROM discovery_seed_runs WHERE run_at<?')
        .bind(new Date(now - 30 * 86400000).toISOString()),
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
        // Refreshed metadata is re-assessed: a video that no longer qualifies leaves the catalogue.
        for (let i = 0; i < stale.results.length; i += 50) {
          const ids = stale.results.slice(i, i + 50).map((v) => v.video_id),
            videos = await api.videos(ids, [], now);
          const result = await ingestVideos(db, ids, videos, now);
          refreshed += videos.length;
          rejected += result.rejected;
        }
        // Videos already prepared from trusted Japanese captions are the most useful additions.
        const backfill = await preparedBackfillIds(db, now);
        if (backfill.length) {
          const result = await ingestVideos(db, backfill, await api.videos(backfill, [], now), now);
          backfilled += result.accepted;
          rejected += result.rejected;
        }
        const seeds = chooseSeeds(await dueSeeds(db, now), await catalogueCoverage(db), now);
        for (const seed of seeds) {
          const order = seedOrder(seed);
          const found = await api.search(seed.query, order);
          searches++;
          // Recently rejected IDs are not re-requested; they still count towards the seed's yield.
          const skip = await recentlyRejected(db, found, now);
          const ids = found.filter((id) => !skip.has(id));
          const result = ids.length
            ? await ingestVideos(db, ids, await api.videos(ids, [seed.topic], now), now, seed)
            : { accepted: 0, rejected: 0, reasons: {} as Record<string, number> };
          if (skip.size) result.reasons['previously-rejected'] = skip.size;
          accepted += result.accepted;
          rejected += result.rejected;
          const updated = {
            ...seed,
            runs: seed.runs + 1,
            returned: seed.returned + found.length,
            accepted: seed.accepted + result.accepted,
          };
          await db.batch([
            db
              .prepare(
                'UPDATE discovery_seed_queries SET last_run_at=?,next_run_at=?,runs=?,returned=?,accepted=? WHERE id=?',
              )
              .bind(
                time,
                new Date(now + seedCooldown(updated)).toISOString(),
                updated.runs,
                updated.returned,
                updated.accepted,
                seed.id,
              ),
            db
              .prepare(
                'INSERT INTO discovery_seed_runs(seed_id,run_at,search_order,returned,accepted,rejected,reasons_json) VALUES(?,?,?,?,?,?,?)',
              )
              .bind(
                seed.id,
                time,
                order,
                found.length,
                result.accepted,
                result.rejected,
                JSON.stringify(result.reasons),
              ),
          ]);
        }
      }
    } catch (error) {
      storageEvent(
        error instanceof YoutubeDataError
          ? `discover.refresh.${error.code}`
          : 'discover.refresh.provider_unavailable',
      );
    }
    // An upstream outage/quota limit must not stop local re-assessment, analysis reuse or metrics.
    const reassessed = await reassessCatalogue(db, now);
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
      JSON.stringify({
        event: 'discover.refresh',
        searches,
        refreshed,
        accepted,
        rejected,
        backfilled,
        reassessed: reassessed.reassessed,
        removed: reassessed.removed,
        keyConfigured: !!apiKey,
      }),
    );
    console.info(
      JSON.stringify({
        event: 'discover.health',
        ...(await catalogueHealth(db, now, youtubeQuotaWindow(now).day)),
      }),
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
