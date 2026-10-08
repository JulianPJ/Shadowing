import { resolveMediaUrl } from './media';
import {
  linkedTranscripts,
  transcriptHash,
  storedMediaIdentity,
  validateStoredTranscript,
  type LinkedTranscriptRepository,
} from './linked-transcripts';
import { storageFallback, storageEvent } from './d1';
import { segmentTranscript, validateCues } from './segmentation';
import type { Lesson, ResolvedMedia, TranscriptionProvider, TranscriptSource } from './types';
import { logPreparationError } from './providers/errors';
import { readBoundedText, BodyLimitError } from './http-body';

export function createPrepareHandler({
  captions,
  repository = linkedTranscripts,
  fetchImpl = fetch,
  onOutcome,
}: {
  captions: TranscriptionProvider;
  repository?: LinkedTranscriptRepository;
  fetchImpl?: typeof fetch;
  onOutcome?: (videoId: string, code: string | null) => Promise<void>;
}) {
  return async function POST(request: Request) {
    let resolved: ResolvedMedia;
    try {
      const text = await readBoundedText(request, 12000);
      if (text.length > 3000) throw new Error('The URL is too long.');
      const input = JSON.parse(text);
      if (!input || typeof input.url !== 'string') throw new Error('Enter a valid video link.');
      resolved = await resolveMediaUrl(input.url);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof BodyLimitError
              ? 'The URL is too long.'
              : error instanceof Error && !(error instanceof SyntaxError)
                ? error.message
                : 'Enter a valid video link.',
          code: 'invalid-url',
        },
        { status: 400 },
      );
    }
    const encoder = new TextEncoder();
    const cancellation = new AbortController();
    const signal = AbortSignal.any([
      request.signal,
      cancellation.signal,
      AbortSignal.timeout(23000),
    ]);
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (data: unknown) => {
          try {
            controller.enqueue(encoder.encode(JSON.stringify(data) + '\n'));
          } catch {
            /* Client navigated away. */
          }
        };
        const media = resolved.media;
        const videoId = media.type === 'youtube' ? media.videoId : undefined;
        let title = 'Japanese video';
        let author =
          media.type === 'youtube' ? 'YouTube' : media.type === 'vimeo' ? 'Vimeo' : 'Direct video';
        let stage = 'identify';
        const started = Date.now();
        try {
          emit({ stage: 'identify', message: 'Finding your video…', resolved });
          // Only this allowlisted official endpoint is fetched server-side. Keep the caption relay unchanged.
          if (videoId) {
            try {
              const response = await fetchImpl(
                `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`,
                { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) },
              );
              console.info(
                JSON.stringify({
                  event: 'preparation.metadata',
                  videoId,
                  status: response.status,
                  elapsedMs: Date.now() - started,
                }),
              );
              if (response.ok) {
                const metadata = await response.json();
                if (typeof metadata.title === 'string') title = metadata.title.slice(0, 500);
                if (typeof metadata.author_name === 'string')
                  author = metadata.author_name.slice(0, 300);
              }
            } catch (error) {
              logPreparationError(error, {
                stage: 'metadata',
                provider: 'YouTube oEmbed',
                videoId,
                signal,
              });
            }
          }
          resolved = { ...resolved, title, author };
          stage = 'captions';
          emit({
            stage,
            message: 'Looking for Japanese captions…',
            resolved,
            video: { videoId, title, author },
          });
          const stored = await storageFallback('d1.transcript.lookup_failed', null, async () => {
            const candidate = await repository.lookup({
              contentKey: media.contentKey,
              language: 'ja',
            });
            if (!candidate) return null;
            const safe = await validateStoredTranscript(candidate);
            return safe.contentKey === media.contentKey ? safe : null;
          });
          storageEvent(stored ? 'd1.transcript.hit' : 'd1.transcript.miss');
          if (!stored && !videoId) {
            emit({
              code: 'no-caption-provider',
              error:
                'No Japanese subtitles were found automatically. Add your own transcript to continue.',
              resolved,
            });
            return;
          }
          const result = stored
            ? { cues: validateCues(stored.cues), provider: stored.source.provider }
            : await captions.transcribe(videoId!, signal);
          stage = 'segment';
          emit({ stage, message: 'Finding natural places to pause…' });
          const cues = validateCues(result.cues);
          const segments = segmentTranscript(cues);
          if (!segments.length) throw new Error('No spoken sections were found.');
          const hash = await transcriptHash(cues);
          if (
            stored &&
            (stored.schemaVersion !== 1 ||
              stored.contentKey !== media.contentKey ||
              stored.language !== 'ja' ||
              stored.transcriptHash !== hash)
          )
            throw new Error('Stored transcript does not match this media.');
          const transcript: TranscriptSource = stored?.source || {
            schemaVersion: 1,
            type: 'provider-captions',
            language: 'ja',
            provenance: result.provider || captions.name,
            provider: result.provider || captions.name,
            transcriptHash: hash,
            normalizationVersion: 1,
            segmentationVersion: 1,
          };
          if (!stored)
            await storageFallback('d1.transcript.save_failed', undefined, () =>
              repository.save({
                schemaVersion: 1,
                contentKey: media.contentKey,
                media: storedMediaIdentity(media),
                language: 'ja',
                source: transcript,
                cues,
                transcriptHash: hash,
                createdAt: new Date().toISOString(),
                visibility: 'system',
              }),
            );
          const lesson: Lesson = {
            id:
              media.type === 'direct'
                ? `direct-${media.contentKey.slice(7)}`
                : `${media.type}-${media.videoId}`,
            videoId,
            title:
              'title' in result && typeof result.title === 'string' && result.title
                ? result.title.slice(0, 500)
                : title,
            author:
              'author' in result && typeof result.author === 'string' && result.author
                ? result.author.slice(0, 300)
                : author,
            source: media.type,
            mediaSource: media,
            mediaUrl: media.type === 'direct' ? media.canonicalUrl : undefined,
            transcriptSource: transcript.provenance,
            transcript,
            segments,
          };
          console.info(
            JSON.stringify({
              event: 'preparation.done',
              videoId,
              cues: cues.length,
              segments: segments.length,
              elapsedMs: Date.now() - started,
            }),
          );
          if (videoId && onOutcome)
            await storageFallback('discover.preparation.state_failed', undefined, () =>
              onOutcome(videoId, null),
            );
          emit({ stage: 'done', lesson });
        } catch (error) {
          const failure = logPreparationError(error, {
            stage,
            provider: captions.name,
            videoId,
            signal,
            elapsedMs: Date.now() - started,
          });
          if (videoId && onOutcome && !signal.aborted)
            await storageFallback('discover.preparation.state_failed', undefined, () =>
              onOutcome(videoId, failure.code),
            );
          emit({ ...failure, resolved, video: { videoId, title, author } });
        } finally {
          try {
            controller.close();
          } catch {
            /* Stream already closed. */
          }
        }
      },
      cancel() {
        cancellation.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    });
  };
}
