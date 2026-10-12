import type { D1Database } from '../d1';
import { storageEvent } from '../d1';
import {
  createD1LinkedTranscriptRepository,
  storedMediaIdentity,
  transcriptHash,
  validateStoredTranscript,
} from '../linked-transcripts';
import {
  createD1GeneratedArtifactRepository,
  DIFFICULTY_GENERATOR_VERSION,
} from '../generated-artifacts';
import { segmentTranscript, validateCues } from '../segmentation';
import { validateQuizLesson } from '../transcript';
import {
  loadSharedArtifact,
  saveSharedArtifact,
  trustedContent,
  type SharedContentDependencies,
} from '../shared-content';
import {
  createWorkersAiDifficultyProvider,
  DifficultyProviderError,
  generateLessonDifficulty,
} from '../providers/difficulty';
import type { WorkersAiBindingLike } from '../providers/workers-ai';
import { normalizePreparationError, type PreparationErrorCode } from '../providers/errors';
import type { Cue, LinkedMediaSource, TranscriptionProvider } from '../types';
import { recordPreparationState } from './preparation-state';
import { declaredBand } from './declared-level';
import { bandFromRange, type Band } from './types';

/**
 * Nightly difficulty analysis for catalogue videos whose metadata states no level. Each attempt
 * prepares the video's Japanese captions exactly as a learner's preparation would (one system
 * transcript, the caption relay first) and stores a full-coverage difficulty artifact, so the next
 * catalogue run links a verified level and a learner who later opens the video reuses both.
 *
 * Captions are the scarce resource: bulk fetching risks YouTube throttling the relay host, so a
 * few videos run per invocation within a small nightly cap. Inference is cheap by comparison
 * (Clef-flash is about 3,455 neurons per million input tokens).
 */
export const ANALYSIS_PER_RUN = 2;
export const ANALYSIS_PER_NIGHT = 32;
// Longer videos cost more caption retrieval and tokens for one catalogue entry.
const MAX_DURATION_SECONDS = 40 * 60;
const CAPTION_TIMEOUT_MS = 25000;
const INFERENCE_TIMEOUT_MS = 60000;
// Content outcomes are recorded like a learner's preparation. Anything else (a blocked or
// unreachable relay) says nothing about the video and stops the run instead.
const CONTENT_FAILURES: PreparationErrorCode[] = [
  'no-japanese-captions',
  'video-unavailable',
  'internal',
];
const ANALYSIS_FAILED = 'analysis-failed';

type Candidate = { video_id: string; title: string; description: string; learner: number };
/**
 * Unanalysed, available videos without a failed or captionless preparation. Reported captions
 * and higher quality go first. The ordering scans the catalogue (about two thousand rows), which
 * is acceptable for a handful of nightly runs.
 */
async function candidates(db: D1Database, now: number) {
  const time = new Date(now).toISOString();
  const rows = await db
    .prepare(
      `SELECT v.video_id, v.title, v.description_excerpt AS description,
        COALESCE(CASE WHEN s.audience_evidence IS NOT NULL THEN s.audience END,
          CASE WHEN v.orientation_evidence IS NOT NULL THEN v.orientation_hint END)='learner' AS learner
      FROM discovery_videos v LEFT JOIN discovery_video_state s ON s.video_id=v.video_id
      WHERE v.status='available' AND v.embeddable=1 AND v.expires_at>? AND v.duration_seconds<=?
        AND (s.video_id IS NULL OR (s.analysis_verified_at IS NULL
          AND s.preparation_status IN ('unknown','prepared')
          AND (s.last_failure_code IS NULL OR s.last_failure_code<>?)
          AND (s.cooldown_until IS NULL OR s.cooldown_until<=?)))
      ORDER BY v.caption_flag DESC, COALESCE(v.quality_score,0) DESC, v.video_id
      LIMIT 200`,
    )
    .bind(time, MAX_DURATION_SECONDS, ANALYSIS_FAILED, time)
    .all<Candidate>();
  // The creator's own label already places these; analysis is for videos with nothing to go on.
  return rows.results.filter((r) => !declaredBand(r.title, r.description ?? '', !!r.learner));
}

/** Atomically reserves one of today's attempts; false once the cap is reached. */
async function reserveAttempt(db: D1Database, now: number, cap: number) {
  const day = `analysis:${new Date(now).toISOString().slice(0, 10)}`;
  return !!(await db
    .prepare(
      `INSERT INTO discovery_quota(day,units) VALUES(?,1)
        ON CONFLICT(day) DO UPDATE SET units=discovery_quota.units+1
        WHERE discovery_quota.units+1<=? RETURNING day`,
    )
    .bind(day, cap)
    .first());
}

class StopRun extends Error {}

export type AnalysisOutcome = {
  videoId: string;
  title: string;
  outcome: 'analysed' | 'reused' | 'no-captions' | 'failed';
  band?: Band | null;
};
const bandOf = (payload: unknown) => {
  const overall = (payload as { overall?: { jlptMin?: string; jlptMax?: string } }).overall;
  return overall?.jlptMin && overall.jlptMax
    ? bandFromRange(overall.jlptMin, overall.jlptMax)
    : null;
};

/**
 * Scheduled runs use the defaults. A manual run (the admin endpoint) chooses its own limit and
 * passes `nightlyCap: null` to spend neurons beyond the nightly cap; both share one lease.
 */
export async function analyseUnplacedVideos({
  db,
  ai,
  captions,
  now = Date.now(),
  limit = ANALYSIS_PER_RUN,
  nightlyCap = ANALYSIS_PER_NIGHT,
}: {
  db: D1Database;
  ai: WorkersAiBindingLike;
  captions: TranscriptionProvider;
  now?: number;
  limit?: number;
  nightlyCap?: number | null;
}) {
  const lease = new Date(now + 14 * 60000).toISOString();
  const acquired = await db
    .prepare(
      `INSERT INTO discovery_jobs(id,lease_until) VALUES('analysis',?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE discovery_jobs.lease_until<? RETURNING id`,
    )
    .bind(lease, new Date(now).toISOString())
    .first();
  const counts = { attempted: 0, analysed: 0, reused: 0, noCaptions: 0, failed: 0 };
  const results: AnalysisOutcome[] = [];
  if (!acquired) return { ...counts, stopped: 'busy', results };
  const reserve = async () => nightlyCap === null || (await reserveAttempt(db, now, nightlyCap));
  const storage: SharedContentDependencies = {
    transcripts: createD1LinkedTranscriptRepository(db),
    artifacts: createD1GeneratedArtifactRepository(db),
  };
  // A failed model call (including an exhausted daily allocation) must stop the run rather than
  // mark the video, so calls are observed before the provider maps them to its public errors.
  let inferenceFailed = false;
  const provider = createWorkersAiDifficultyProvider({
    async run(model, input, options) {
      try {
        return await ai.run(model, input, options);
      } catch (error) {
        inferenceFailed = true;
        throw error;
      }
    },
  });
  let stopped: string | null = null;
  try {
    for (const candidate of await candidates(db, now)) {
      if (counts.attempted >= limit) break;
      const id = candidate.video_id,
        contentKey = `youtube:${id}`;
      const report = (outcome: AnalysisOutcome['outcome'], band?: Band | null) =>
        results.push({ videoId: id, title: candidate.title, outcome, band });
      const media: LinkedMediaSource = {
        schemaVersion: 1,
        type: 'youtube',
        provider: 'youtube',
        videoId: id,
        canonicalUrl: `https://www.youtube.com/watch?v=${id}`,
        contentKey,
      };
      let cues: Cue[];
      const stored = await storage.transcripts.lookup({ contentKey, language: 'ja' });
      if (stored) {
        const safe = await validateStoredTranscript(stored);
        cues = validateCues(safe.cues);
      } else {
        if (!(await reserve())) throw new StopRun('nightly-cap');
        counts.attempted++;
        try {
          const result = await captions.transcribe(id, AbortSignal.timeout(CAPTION_TIMEOUT_MS));
          cues = validateCues(result.cues);
          if (!segmentTranscript(cues).length) throw new Error('No spoken sections were found.');
          const hash = await transcriptHash(cues);
          await storage.transcripts.save({
            schemaVersion: 1,
            contentKey,
            media: storedMediaIdentity(media),
            language: 'ja',
            source: {
              schemaVersion: 1,
              type: 'provider-captions',
              language: 'ja',
              provenance: result.provider || captions.name,
              provider: result.provider || captions.name,
              transcriptHash: hash,
              normalizationVersion: 1,
              segmentationVersion: 1,
            },
            cues,
            transcriptHash: hash,
            createdAt: new Date(now).toISOString(),
            visibility: 'system',
          });
          await recordPreparationState(db, id, null);
        } catch (error) {
          const { code } = normalizePreparationError(error);
          if (!CONTENT_FAILURES.includes(code)) throw new StopRun(`captions:${code}`);
          await recordPreparationState(db, id, code);
          if (code === 'no-japanese-captions') counts.noCaptions++;
          else counts.failed++;
          report(code === 'no-japanese-captions' ? 'no-captions' : 'failed');
          continue;
        }
      }
      const lesson = validateQuizLesson(
        { id: `youtube-${id}`, segments: segmentTranscript(cues) },
        { maxSegments: 10000, maxCharacters: 300000 },
      );
      const trusted = await trustedContent(
        contentKey,
        lesson,
        'difficulty',
        DIFFICULTY_GENERATOR_VERSION,
        storage,
      );
      // An existing artifact only awaits the catalogue run's verification.
      const existing = trusted && (await loadSharedArtifact(trusted, lesson, storage));
      if (!trusted || existing) {
        if (existing) {
          counts.reused++;
          report('reused', bandOf(existing));
        }
        continue;
      }
      if (stored) {
        if (!(await reserve())) throw new StopRun('nightly-cap');
        counts.attempted++;
      }
      try {
        const payload = await generateLessonDifficulty(
          trusted.lesson,
          AbortSignal.timeout(INFERENCE_TIMEOUT_MS),
          provider,
        );
        await saveSharedArtifact(trusted, payload, storage);
        counts.analysed++;
        report('analysed', bandOf(payload));
      } catch (error) {
        if (
          inferenceFailed ||
          (error instanceof DifficultyProviderError && error.code === 'unavailable')
        )
          throw new StopRun('inference-unavailable');
        // Malformed or too-short results are not retried nightly; a learner's preparation clears
        // the mark.
        await db
          .prepare(
            `INSERT INTO discovery_video_state(video_id,last_failure_code) VALUES(?,?)
            ON CONFLICT(video_id) DO UPDATE SET last_failure_code=excluded.last_failure_code`,
          )
          .bind(id, ANALYSIS_FAILED)
          .run();
        counts.failed++;
        report('failed');
      }
    }
  } catch (error) {
    if (error instanceof StopRun) stopped = error.message;
    else {
      stopped = 'unavailable';
      storageEvent('discover.analysis.unavailable');
    }
  } finally {
    await db
      .prepare("DELETE FROM discovery_jobs WHERE id='analysis' AND lease_until=?")
      .bind(lease)
      .run();
  }
  console.info(
    JSON.stringify({ event: 'discover.analysis', manual: nightlyCap === null, ...counts, stopped }),
  );
  return { ...counts, stopped, results };
}
