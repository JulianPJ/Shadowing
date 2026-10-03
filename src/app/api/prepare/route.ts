import { parseYouTubeUrl } from '@/lib/youtube';
import { youtubeCaptions } from '@/lib/providers/transcription';
import { segmentTranscript } from '@/lib/segmentation';
import type { Lesson } from '@/lib/types';
import { logPreparationError } from '@/lib/providers/errors';

export const maxDuration = 30;
export async function POST(request: Request) {
  let videoId: string;
  try {
    const text = await request.text();
    if (text.length > 3000) throw new Error('The URL is too long.');
    const input = JSON.parse(text);
    if (!input || typeof input.url !== 'string') throw new Error('Enter a valid YouTube video URL.');
    videoId = parseYouTubeUrl(input.url);
  } catch (error) {
    return Response.json({ error: error instanceof Error && !(error instanceof SyntaxError) ? error.message : 'Enter a valid YouTube URL.', code: 'invalid-url' }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal, AbortSignal.timeout(23000)]);
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: unknown) => { try { controller.enqueue(encoder.encode(JSON.stringify(data) + '\n')); } catch { /* Client navigated away. */ } };
      let title = 'Japanese video'; let author = 'YouTube';
      let stage = 'identify';
      const started = Date.now();
      try {
        emit({ stage: 'identify', message: 'Finding your video…' });
        // Metadata is a best-effort official oEmbed request; it never blocks captions indefinitely.
        try {
          const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
          console.info(JSON.stringify({ event: 'preparation.metadata', videoId, status: response.status, elapsedMs: Date.now() - started }));
          if (response.ok) { const metadata = await response.json(); title = metadata.title; author = metadata.author_name; }
        } catch (error) { logPreparationError(error, { stage: 'metadata', provider: 'YouTube oEmbed', videoId, signal }); }
        stage = 'captions';
        emit({ stage: 'captions', message: 'Looking for Japanese captions…', video: { videoId, title, author } });
        const result = await youtubeCaptions.transcribe(videoId, signal);
        stage = 'segment';
        emit({ stage: 'segment', message: 'Finding natural places to pause…' });
        const segments = segmentTranscript(result.cues);
        if (!segments.length) throw new Error('No spoken sections were found.');
        const lesson: Lesson = { id: `youtube-${videoId}`, videoId, title: result.title || title, author: result.author || author, source: 'youtube', transcriptSource: result.provider || youtubeCaptions.name, segments };
        console.info(JSON.stringify({ event: 'preparation.done', videoId, cues: result.cues.length, segments: segments.length, elapsedMs: Date.now() - started }));
        emit({ stage: 'done', lesson });
      } catch (error) {
        const failure = logPreparationError(error, { stage, provider: 'youtube-transcript-plus', videoId, signal, elapsedMs: Date.now() - started });
        emit({ ...failure, video: { videoId, title, author } });
      } finally { try { controller.close(); } catch { /* Stream already closed. */ } }
    },
    cancel() { cancellation.abort(); },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
