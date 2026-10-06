import { lessonMedia } from '../media';
import { transcriptKey } from '../transcript';
import type { Lesson, Segment } from '../types';
import type { DictionarySource } from './types';

function safeDirectUrl(value: string) {
  try {
    const url = new URL(value);
    return url.search || url.username || url.password || url.hash ? null : url.href;
  } catch {
    return null;
  }
}

export async function dictionarySource(
  lesson: Lesson,
  segment: Segment,
): Promise<DictionarySource> {
  const media = lessonMedia(lesson);
  const mediaId = 'videoId' in media ? media.videoId : null;
  const mediaContentKey = 'contentKey' in media ? media.contentKey : null;
  const mediaUrl =
    media.type === 'youtube' || media.type === 'vimeo'
      ? media.canonicalUrl
      : media.type === 'direct'
        ? safeDirectUrl(media.canonicalUrl)
        : null;
  return {
    lessonId: lesson.id,
    segmentId: segment.id,
    lessonTitle: lesson.title,
    lessonAuthor: lesson.author,
    mediaType: media.type,
    mediaId,
    mediaUrl,
    mediaContentKey,
    transcriptKey: await transcriptKey(lesson),
    start: segment.start,
    end: segment.end,
  };
}
