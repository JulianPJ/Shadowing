import type { D1Database } from './d1';
import { storageEvent } from './d1';
import { createD1LinkedTranscriptRepository } from './linked-transcripts';
import {
  createD1GeneratedArtifactRepository,
  DIFFICULTY_GENERATOR_VERSION,
} from './generated-artifacts';
import { segmentTranscript } from './segmentation';
import { transcriptKey } from './transcript';
import { validateDifficultyAnalysis } from './difficulty';
import { readBoundedText } from './http-body';
import type { ContentDifficultyAnalysis, Lesson } from './types';

export type DiscoverySnapshot = { lessons: Lesson[]; difficulties: ContentDifficultyAnalysis[] };

/** Public provider captions only. Learner state and private imports never enter discovery. */
export async function loadPublicDiscovery(
  db?: D1Database,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<DiscoverySnapshot> {
  const result: DiscoverySnapshot = { lessons: [], difficulties: [] };
  if (!db) return result;
  try {
    const rows = await db
      .prepare(
        `SELECT content_key FROM linked_transcripts
      WHERE media_type='youtube' AND provider='youtube' AND language='ja'
      AND visibility='system' AND owner_user_id IS NULL AND source_type='provider-captions'
      AND schema_version=1 AND normalization_version=1 AND segmentation_version=1
      AND length(cues_json) <= 200000
      GROUP BY content_key ORDER BY MAX(created_at) DESC, content_key LIMIT 24`,
      )
      .all<{ content_key: string }>();
    const transcripts = createD1LinkedTranscriptRepository(db);
    const artifacts = createD1GeneratedArtifactRepository(db);
    for (const row of rows.results) {
      if (result.lessons.length >= 12 || signal?.aborted) break;
      // lookup revalidates canonical media, cue hashes and provenance. Never trust SQL alone.
      const stored = await transcripts.lookup({ contentKey: row.content_key, language: 'ja' });
      if (!stored || stored.visibility !== 'system' || stored.source.type !== 'provider-captions')
        continue;
      const segments = segmentTranscript(stored.cues);
      // Bound the response without publishing sparse transcripts as full-coverage estimates.
      if (
        !segments.length ||
        segments.length > 500 ||
        segments.reduce((n, s) => n + s.japanese.length, 0) > 20_000
      )
        continue;
      const videoId = row.content_key.slice(8);
      const lesson: Lesson = {
        id: `youtube-${videoId}`,
        title: `Japanese listening · ${videoId}`,
        author: 'YouTube',
        source: 'youtube',
        videoId,
        segments,
        transcriptSource: 'Public Japanese captions',
        mediaSource: {
          schemaVersion: 1,
          type: 'youtube',
          provider: 'youtube',
          videoId,
          canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
          contentKey: row.content_key,
        },
        transcript: stored.source,
      };
      result.lessons.push(lesson);
      try {
        const artifact = await artifacts.lookup({
          contentKey: row.content_key,
          transcriptKey: await transcriptKey(lesson),
          artifactType: 'difficulty',
          schemaVersion: 1,
          generatorVersion: DIFFICULTY_GENERATOR_VERSION,
        });
        if (artifact?.sourceTranscriptHash === stored.transcriptHash)
          result.difficulties.push(await validateDifficultyAnalysis(artifact.payload, lesson));
      } catch {
        /* An optional estimate never excludes valid captions. */
      }
    }
    // Metadata has its own short deadline, bounded body and fixed official endpoint.
    const metadataResults = await Promise.allSettled(
      result.lessons.map(async (lesson) => {
        const response = await fetchImpl(
          `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${lesson.videoId}&format=json`,
          { signal: AbortSignal.any([AbortSignal.timeout(2500), ...(signal ? [signal] : [])]) },
        );
        if (!response.ok) return false;
        const metadata = JSON.parse(await readBoundedText(response, 16_000));
        if (typeof metadata.title !== 'string' || !metadata.title.trim()) return false;
        lesson.title = metadata.title.slice(0, 500);
        if (typeof metadata.author_name === 'string')
          lesson.author = metadata.author_name.slice(0, 300);
        return true;
      }),
    );
    // Missing official metadata can mean a removed/private video; do not recommend it.
    result.lessons = result.lessons.filter(
      (_, index) => metadataResults[index].status === 'fulfilled' && metadataResults[index].value,
    );
    const available = new Set(result.lessons.map((lesson) => lesson.id));
    result.difficulties = result.difficulties.filter((difficulty) =>
      available.has(difficulty.lessonId),
    );
    return result;
  } catch {
    storageEvent('d1.discovery.unavailable');
    return { lessons: [], difficulties: [] };
  }
}

export async function handleDiscoveryRequest(
  request: Request,
  db?: D1Database,
  fetchImpl?: typeof fetch,
) {
  if (request.method !== 'GET')
    return Response.json(
      { error: 'Method not supported' },
      { status: 405, headers: { Allow: 'GET' } },
    );
  return Response.json(await loadPublicDiscovery(db, fetchImpl, request.signal), {
    headers: { 'Cache-Control': db ? 'public, max-age=300' : 'no-store' },
  });
}
