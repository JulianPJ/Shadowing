import { parseYouTubeUrl } from '@/lib/youtube';
import { youtubeCaptions } from '@/lib/providers/transcription';
import { segmentTranscript } from '@/lib/segmentation';
import type { Lesson } from '@/lib/types';

export const maxDuration = 30;
export async function POST(request: Request) {
  let videoId: string;
  try {
    const text = await request.text();
    if (text.length > 3000) throw new Error('The URL is too long.');
    videoId = parseYouTubeUrl(JSON.parse(text).url ?? '');
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Enter a valid YouTube URL.' }, { status: 400 });
  }
  const encoder = new TextEncoder();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(23000)]);
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (data: unknown) => { try { controller.enqueue(encoder.encode(JSON.stringify(data) + '\n')); } catch { /* Client navigated away. */ } };
      let title = 'Japanese video'; let author = 'YouTube';
      try {
        emit({ stage: 'identify', message: 'Finding your video…' });
        // Metadata is a best-effort official oEmbed request; it never blocks captions indefinitely.
        try {
          const response = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
          if (response.ok) { const metadata = await response.json(); title = metadata.title; author = metadata.author_name; }
        } catch { /* Captions can still succeed when oEmbed fails. */ }
        emit({ stage: 'captions', message: 'Looking for Japanese captions…', video: { videoId, title, author } });
        const result = await youtubeCaptions.transcribe(videoId, signal);
        emit({ stage: 'segment', message: 'Finding natural places to pause…' });
        const segments = segmentTranscript(result.cues);
        if (!segments.length) throw new Error('No spoken sections were found.');
        const lesson: Lesson = { id: `youtube-${videoId}`, videoId, title: result.title || title, author: result.author || author, source: 'youtube', transcriptSource: youtubeCaptions.name, segments };
        emit({ stage: 'done', lesson });
      } catch (error) {
        const name = error instanceof Error ? error.name : '';
        const code = /Unavailable/.test(name) ? 'video-unavailable' : /TooMany|Timeout|Abort/.test(name) ? 'network' : 'transcript-unavailable';
        emit({ error: code === 'video-unavailable' ? 'YouTube could not make this video available here. Check the link, try another video, or use the demo.' : 'We couldn’t get Japanese captions for this video. Captions may be missing, or YouTube may be limiting access. Import a timestamped transcript to practice this video, or try the demo.', code, video: { videoId, title, author } });
      } finally { try { controller.close(); } catch { /* Stream already closed. */ } }
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' } });
}
