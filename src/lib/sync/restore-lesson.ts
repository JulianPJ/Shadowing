import type { D1Database } from '../d1';
import type { SyncedLesson } from './types';
import {
  createD1LinkedTranscriptRepository,
  validateStoredTranscript,
} from '../linked-transcripts';
import { segmentTranscript } from '../segmentation';
import { transcriptKey } from '../transcript';
import type { Lesson } from '../types';
import demo from '@/data/demo.json' with { type: 'json' };
export async function restorePublicLesson(
  reference: SyncedLesson,
  db?: D1Database,
): Promise<Lesson | null> {
  if (
    reference.lesson.source === 'demo' &&
    reference.lesson.transcriptKey === (await transcriptKey(demo))
  )
    return demo as Lesson;
  if (!db || reference.lesson.source !== 'youtube' || !reference.contentKey?.startsWith('youtube:'))
    return null;
  const stored = await createD1LinkedTranscriptRepository(db).lookup({
    contentKey: reference.contentKey,
    language: 'ja',
  });
  if (!stored) return null;
  const valid = await validateStoredTranscript(stored),
    segments = segmentTranscript(valid.cues);
  const videoId = reference.contentKey.slice(8);
  const lesson: Lesson = {
    id: reference.lesson.lessonId,
    title: reference.lesson.title,
    author: reference.lesson.author,
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
      contentKey: reference.contentKey,
    },
    transcript: {
      schemaVersion: 1,
      type: 'provider-captions',
      language: 'ja',
      provenance: valid.source.provenance,
      normalizationVersion: 1,
      segmentationVersion: 1,
    },
  };
  return (await transcriptKey(lesson)) === reference.lesson.transcriptKey ? lesson : null;
}
