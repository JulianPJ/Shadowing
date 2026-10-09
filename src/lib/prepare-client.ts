'use client';
import { resolveMediaUrl } from './media';
import { needsUserTranscript } from './linked-transcripts';
import type { Lesson, ResolvedMedia } from './types';
type Preparation = { resolved: ResolvedMedia; lesson?: Lesson; needsTranscript?: string };
/** Shared URL preparation transport; pages own progress, import continuation and navigation. */
export async function prepareLinkedVideo(
  url: string,
  signal: AbortSignal,
  onProgress: (stage: string, message: string, resolved?: ResolvedMedia) => void,
): Promise<Preparation> {
  let resolved = await resolveMediaUrl(url);
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
  onProgress('identify', 'Finding your video…', resolved);
  if (resolved.media.type !== 'youtube')
    return {
      resolved,
      needsTranscript:
        'No Japanese subtitles were found automatically. Add your own transcript to continue.',
    };
  const response = await fetch('/api/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: resolved.media.canonicalUrl }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
  });
  if (!response.ok) {
    const body = await response.json();
    throw new Error(body.error || 'We couldn’t prepare this video. Try again.');
  }
  if (!response.body) throw new Error('The connection ended unexpectedly. Please try again.');
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = '';
  let stage = 'identify',
    message = 'Finding your video…';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      if (buffer.length > 2000000) throw new Error('Preparation response is too large.');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      if (done && buffer.trim()) {
        lines.push(buffer);
        buffer = '';
      }
      for (const line of lines) {
        if (!line.trim()) continue;
        const data = JSON.parse(line);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (data.resolved) resolved = { ...data.resolved, originalUrl: resolved.originalUrl };
        if (data.error) {
          if (needsUserTranscript(data.code)) return { resolved, needsTranscript: data.error };
          throw new Error(data.error);
        }
        if (data.stage) stage = data.stage;
        if (data.message) message = data.message;
        onProgress(stage, message, resolved);
        if (data.lesson) return { resolved, lesson: data.lesson };
      }
      if (done) break;
    }
    throw new Error('The connection ended before the transcript was ready. Please try again.');
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
