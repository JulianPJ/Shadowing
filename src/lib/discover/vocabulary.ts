'use client';
import { storageAccount } from '../storage/browser';
import { loadLesson } from '../storage/lessons';
import { loadKnowledge } from '../knowledge/client';
import { transcriptKey } from '../transcript';
import type { Video } from './types';
/** Refine already-rendered recommendations only when this device has matching prepared content. */
export async function localVocabularyFit(
  videos: Video[],
  signal: AbortSignal,
): Promise<Record<string, number>> {
  const owner = storageAccount();
  if (Object.keys(loadKnowledge()).length < 5) return {};
  const candidates = videos
    .slice(0, 24)
    .flatMap((video) => {
      const lesson = loadLesson(`youtube-${video.videoId}`);
      return video.proof &&
        lesson &&
        lesson.segments.length <= 500 &&
        lesson.segments.reduce((n, s) => n + s.japanese.length, 0) <= 20000
        ? [{ video, lesson }]
        : [];
    })
    .slice(0, 8);
  if (!candidates.length) return {};
  const { lessonVocabulary } = await import('../knowledge/lesson');
  const result: Record<string, number> = {};
  for (const { video, lesson } of candidates) {
    if (signal.aborted || owner !== storageAccount()) return {};
    if ((await transcriptKey(lesson)) !== video.proof!.transcriptKey) continue;
    const analysis = await lessonVocabulary(lesson);
    if (
      analysis.complete &&
      analysis.knownPercent !== null &&
      analysis.uniqueLemmas >= 10 &&
      analysis.trackedLemmas >= 5
    )
      result[video.videoId] = analysis.knownPercent;
  }
  return !signal.aborted && owner === storageAccount() ? result : {};
}
