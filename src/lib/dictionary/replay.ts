import type { DictionaryEntry } from './types';
export function contextHref(entry: DictionaryEntry) {
  return `/practice/${encodeURIComponent(entry.source.lessonId)}?section=${encodeURIComponent(entry.source.segmentId)}&transcript=${encodeURIComponent(entry.source.transcriptKey)}`;
}
export function reviewContextHref(entry: DictionaryEntry) {
  return contextHref(entry);
}
export function externalReplay(entry: DictionaryEntry) {
  const { mediaType, mediaId, mediaUrl, start } = entry.source;
  if (mediaType === 'youtube' && mediaId)
    return `https://www.youtube.com/watch?v=${encodeURIComponent(mediaId)}&t=${Math.floor(start)}s`;
  // Export/replay never propagates access hashes, signed query strings or credentials.
  if (mediaType === 'vimeo' && mediaId)
    return `https://vimeo.com/${encodeURIComponent(mediaId)}#t=${Math.floor(start)}s`;
  if (mediaType !== 'direct' || !mediaUrl) return null;
  try {
    const url = new URL(mediaUrl);
    return ['http:', 'https:'].includes(url.protocol) &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password
      ? `${url.href}#t=${start}`
      : null;
  } catch {
    return null;
  }
}
