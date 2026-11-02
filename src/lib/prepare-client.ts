'use client';
import { resolveMediaUrl } from './media';
import { needsUserTranscript } from './linked-transcripts';
import { bridgeReadsYouTube, lessonFromBridgeCaptions } from './extension/youtube-captions';
import type { Lesson, ResolvedMedia } from './types';
type Preparation = { resolved: ResolvedMedia; lesson?: Lesson; needsTranscript?: string };

/** A failed server preparation and its error code, when the server sent one. */
export class PreparationError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'PreparationError';
  }
}
// Failures where the learner's own connection may still reach YouTube's captions.
const BRIDGE_RECOVERABLE = new Set([
  'provider-blocked',
  'provider-incompatible',
  'network',
  'network-timeout',
]);
const bridgeMayHelp = (error: unknown) =>
  error instanceof PreparationError
    ? BRIDGE_RECOVERABLE.has(error.code ?? '')
    : error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError');

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
  try {
    return await prepareOnServer(resolved, signal, onProgress, (next) => (resolved = next));
  } catch (error) {
    // When YouTube limits Hibiki's servers, Hibiki Bridge reads the captions from this browser.
    if (signal.aborted || !bridgeMayHelp(error) || !(await bridgeReadsYouTube())) throw error;
    onProgress('captions', 'Reading captions through Hibiki Bridge…', resolved);
    try {
      return { resolved, lesson: await lessonFromBridgeCaptions(resolved, signal) };
    } catch (bridgeError) {
      if (signal.aborted) throw bridgeError;
      const { normalizePreparationError } = await import('./providers/errors');
      const failure = normalizePreparationError(bridgeError);
      if (needsUserTranscript(failure.code)) return { resolved, needsTranscript: failure.error };
      throw error;
    }
  }
}

async function prepareOnServer(
  resolved: ResolvedMedia,
  signal: AbortSignal,
  onProgress: (stage: string, message: string, resolved?: ResolvedMedia) => void,
  onResolved: (resolved: ResolvedMedia) => void,
): Promise<Preparation> {
  const response = await fetch('/api/prepare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: resolved.media.canonicalUrl }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(35000)]),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new PreparationError(
      body.error || 'We couldn’t prepare this video. Try again.',
      response.status === 429 || response.status >= 500 ? 'network' : undefined,
    );
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
        if (data.resolved) {
          resolved = { ...data.resolved, originalUrl: resolved.originalUrl };
          onResolved(resolved);
        }
        if (data.error) {
          if (needsUserTranscript(data.code)) return { resolved, needsTranscript: data.error };
          throw new PreparationError(data.error, data.code);
        }
        if (data.stage) stage = data.stage;
        if (data.message) message = data.message;
        onProgress(stage, message, resolved);
        if (data.lesson) return { resolved, lesson: data.lesson };
      }
      if (done) break;
    }
    throw new PreparationError(
      'The connection ended before the transcript was ready. Please try again.',
      'network',
    );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
