import { transcriptHash } from './linked-transcripts';
import { segmentTranscript } from './segmentation';
import type { Cue, Lesson, ResolvedMedia, TranscriptSource } from './types';

export async function createImportedLesson(input: { resolved?: ResolvedMedia; fileName?: string; mediaUrl?: string; cues: Cue[]; transcriptType: TranscriptSource['type']; provenance: string }): Promise<Lesson> {
  const { resolved, fileName, mediaUrl, cues, provenance, transcriptType } = input;
  if (!resolved && !fileName) throw new Error('Choose your media first.');
  const media = resolved?.media;
  const segments = segmentTranscript(cues);
  if (!segments.length) throw new Error('No usable spoken sections were found. Check the transcript timings.');
  const lesson: Lesson = {
    id: media ? media.type === 'direct' ? `direct-${media.contentKey.slice(7)}` : `${media.type}-${media.videoId}` : `upload-${crypto.randomUUID()}`,
    title: resolved?.title || fileName?.replace(/\.[^.]+$/, '') || 'Your Japanese practice', author: resolved?.author || (media ? `${media.type === 'youtube' ? 'YouTube' : media.type === 'vimeo' ? 'Vimeo' : 'Direct video'} · your transcript` : 'Your own media'),
    source: media?.type || 'upload', videoId: media?.type === 'youtube' ? media.videoId : undefined,
    mediaUrl: media?.type === 'direct' ? media.canonicalUrl : mediaUrl, mediaName: fileName,
    mediaSource: media || { schemaVersion: 1, type: 'local', fileName: fileName! }, segments,
    transcriptSource: provenance, transcript: { schemaVersion: 1, type: transcriptType, language: 'ja', provenance, ...(transcriptType === 'generated' ? { provider: provenance } : {}), transcriptHash: await transcriptHash(cues), normalizationVersion: 1, segmentationVersion: 1 },
  };
  return lesson;
}
