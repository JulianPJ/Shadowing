import type { D1Database } from '../d1';
import { validateDifficultyLesson, validateDifficultyAnalysis } from '../difficulty';
import {
  createD1GeneratedArtifactRepository,
  DIFFICULTY_GENERATOR_VERSION,
} from '../generated-artifacts';
import {
  createD1LinkedTranscriptRepository,
  storedMediaIdentity,
  transcriptHash,
} from '../linked-transcripts';
import { segmentTranscript, validateCues } from '../segmentation';
import { transcriptKey } from '../transcript';
import { normalizePreparationError } from '../providers/errors';
import { DifficultyProviderError, generateLessonDifficulty } from '../providers/difficulty';
import type { DifficultyAnalysisProvider, TranscriptionProvider } from '../types';
import { canonicalUrl, validVideoId } from './types';

// One bounded batch after the scheduled metadata refresh. No YouTube Data API calls.
// Failed captions are retried rarely; temporary outages are retried sooner.
export const DISCOVER_ENRICHMENT_BATCH_SIZE = 6;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function backoff(code: string) {
  if (code === 'no-japanese-captions' || code === 'insufficient-transcript') return 30 * DAY;
  if (code === 'video-unavailable') return 7 * DAY;
  if (code === 'provider-blocked' || code === 'provider-incompatible') return 12 * HOUR;
  return 3 * HOUR;
}

async function recordAttempt(
  db: D1Database,
  videoId: string,
  time: string,
  result: string,
  retryAt: string | null,
) {
  await db
    .prepare(
      'INSERT INTO discovery_enrichment_attempts(video_id,attempts,last_attempt_at,next_attempt_at,last_result) ' +
        'VALUES (?,1,?,?,?) ON CONFLICT(video_id) DO UPDATE SET ' +
        'attempts=discovery_enrichment_attempts.attempts+1,' +
        'last_attempt_at=excluded.last_attempt_at,next_attempt_at=excluded.next_attempt_at,' +
        'last_result=excluded.last_result',
    )
    .bind(videoId, time, retryAt, result)
    .run();
}

/**
 * Run only from a trusted cron invocation. A separate lease prevents overlapping
 * inference batches, while existing D1 artifact identity prevents duplicated cache rows.
 * Metadata-only videos remain visible; failures never manufacture difficulty bands.
 */
export async function enrichDiscoveryCatalogue(
  db: D1Database,
  captions: TranscriptionProvider,
  classifier: DifficultyAnalysisProvider,
  now = Date.now(),
  batchSize = DISCOVER_ENRICHMENT_BATCH_SIZE,
) {
  const time = new Date(now).toISOString();
  const lease = new Date(now + 15 * 60 * 1000).toISOString();
  const acquired = await db
    .prepare(
      "INSERT INTO discovery_jobs(id,lease_until) VALUES('enrichment',?) " +
        'ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until ' +
        'WHERE discovery_jobs.lease_until<? RETURNING id',
    )
    .bind(lease, time)
    .first();
  if (!acquired) return { processed: 0, enriched: 0, failed: 0, leased: true };

  let processed = 0;
  let enriched = 0;
  let failed = 0;
  try {
    const rows = await db
      .prepare(
        'SELECT v.video_id FROM discovery_videos v ' +
          'LEFT JOIN discovery_video_state s ON s.video_id=v.video_id ' +
          'LEFT JOIN discovery_enrichment_attempts e ON e.video_id=v.video_id ' +
          "WHERE v.status='available' AND v.expires_at>? " +
          'AND s.difficulty_artifact_id IS NULL ' +
          'AND (e.next_attempt_at IS NULL OR e.next_attempt_at<=?) ' +
          'ORDER BY v.caption_flag DESC, COALESCE(e.last_attempt_at, \'\') ASC, v.indexed_at DESC ' +
          'LIMIT ?',
      )
      .bind(time, time, Math.max(1, Math.min(batchSize, DISCOVER_ENRICHMENT_BATCH_SIZE)))
      .all<{ video_id: string }>();
    const transcripts = createD1LinkedTranscriptRepository(db);
    const artifacts = createD1GeneratedArtifactRepository(db);

    for (const { video_id: videoId } of rows.results) {
      if (!validVideoId(videoId)) continue;
      processed++;
      let phase: 'captions' | 'difficulty' = 'captions';
      const signal = AbortSignal.timeout(60000);
      try {
        const contentKey = 'youtube:' + videoId;
        let stored = await transcripts.lookup({ contentKey, language: 'ja' });
        if (!stored || stored.visibility !== 'system' || stored.source.type !== 'provider-captions') {
          const result = await captions.transcribe(videoId, signal);
          const cues = validateCues(result.cues);
          const hash = await transcriptHash(cues);
          const provider = result.provider || captions.name;
          await transcripts.save({
            schemaVersion: 1,
            contentKey,
            media: storedMediaIdentity({
              schemaVersion: 1,
              canonicalUrl: canonicalUrl(videoId),
              contentKey,
              type: 'youtube',
              provider: 'youtube',
              videoId,
            }),
            language: 'ja',
            source: {
              schemaVersion: 1,
              type: 'provider-captions',
              language: 'ja',
              provenance: provider,
              provider,
              transcriptHash: hash,
              normalizationVersion: 1,
              segmentationVersion: 1,
            },
            cues,
            transcriptHash: hash,
            visibility: 'system',
            createdAt: time,
          });
          stored = await transcripts.lookup({ contentKey, language: 'ja' });
        }
        if (!stored || stored.visibility !== 'system' || stored.source.type !== 'provider-captions')
          throw new Error('No trusted caption transcript');

        // Preparation and AI classification are independent. Preserve captions if
        // inference fails so a later retry need not call the caption provider.
        await db
          .prepare(
            "UPDATE discovery_video_state SET preparation_status='prepared', " +
              'last_prepared_at=?,last_failure_code=NULL,cooldown_until=NULL WHERE video_id=?',
          )
          .bind(time, videoId)
          .run();

        phase = 'difficulty';
        const lesson = validateDifficultyLesson({
          id: 'youtube-' + videoId,
          segments: segmentTranscript(stored.cues),
        });
        const key = await transcriptKey(lesson);
        const identity = {
          contentKey,
          transcriptKey: key,
          artifactType: 'difficulty' as const,
          schemaVersion: 1,
          generatorVersion: DIFFICULTY_GENERATOR_VERSION,
        };
        let artifact = await artifacts.lookup(identity);
        if (!artifact || artifact.sourceTranscriptHash !== stored.transcriptHash) {
          const analysis = await generateLessonDifficulty(lesson, signal, classifier);
          await artifacts.save(
            {
              ...identity,
              sourceTranscriptHash: stored.transcriptHash,
              payload: analysis,
              payloadId: analysis.id,
              createdAt: analysis.generatedAt,
            },
            lesson,
          );
          artifact = await artifacts.lookup(identity);
        }
        if (!artifact || artifact.sourceTranscriptHash !== stored.transcriptHash)
          throw new Error('Validated difficulty artifact missing');
        await validateDifficultyAnalysis(artifact.payload, lesson);
        const record = await db
          .prepare(
            "SELECT id FROM generated_artifacts WHERE content_key=? AND transcript_key=? " +
              "AND source_transcript_hash=? AND artifact_type='difficulty' " +
              'AND schema_version=1 AND generator_version=?',
          )
          .bind(contentKey, key, stored.transcriptHash, DIFFICULTY_GENERATOR_VERSION)
          .first<{ id: string }>();
        if (!record) throw new Error('Persisted difficulty record not found');
        await db
          .prepare(
            'UPDATE discovery_video_state SET difficulty_artifact_id=?,transcript_key=?,' +
              'transcript_hash=?,analysis_verified_at=? WHERE video_id=?',
          )
          .bind(record.id, key, stored.transcriptHash, time, videoId)
          .run();
        await recordAttempt(db, videoId, time, 'success', null);
        enriched++;
        console.info(
          JSON.stringify({ event: 'discover.enrichment', videoId, status: 'success', at: time }),
        );
      } catch (error) {
        const code =
          error instanceof DifficultyProviderError
            ? error.code
            : phase === 'captions'
              ? normalizePreparationError(error, signal).code
              : signal.aborted
                ? 'timeout'
                : 'unavailable';
        const retryAt = new Date(now + backoff(code)).toISOString();
        await recordAttempt(db, videoId, time, code, retryAt);
        failed++;
        // Never log exception text, captions, credentials or signed URLs.
        console.warn(
          JSON.stringify({
            event: 'discover.enrichment',
            videoId,
            status: 'retry',
            stage: phase,
            code,
            retryAt,
          }),
        );
      }
    }
    console.info(
      JSON.stringify({ event: 'discover.enrichment.batch', processed, enriched, failed, at: time }),
    );
    return { processed, enriched, failed, leased: false };
  } finally {
    await db
      .prepare("DELETE FROM discovery_jobs WHERE id='enrichment' AND lease_until=?")
      .bind(lease)
      .run();
  }
}