import { BodyLimitError, readBoundedBytes } from './http-body';
import type { TranscriptionProvider } from './types';

export const TRANSCRIPTION_MEDIA_LIMIT = 32 * 1024 * 1024;

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function handleTranscriptionRequest(
  request: Request,
  provider: TranscriptionProvider<Uint8Array<ArrayBuffer>>,
  maxBytes = TRANSCRIPTION_MEDIA_LIMIT,
) {
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (
    type &&
    type !== 'application/octet-stream' &&
    !type.startsWith('audio/') &&
    !type.startsWith('video/')
  )
    return noStoreJson({ error: 'Upload an audio or video file to generate subtitles.' }, 415);

  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes)
    return noStoreJson(
      {
        error:
          'AI subtitle generation currently supports media up to 32 MB. For longer video, upload an extracted or compressed audio track.',
      },
      413,
    );

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBoundedBytes(request, maxBytes);
  } catch (error) {
    if (error instanceof BodyLimitError)
      return noStoreJson(
        {
          error:
            'AI subtitle generation currently supports media up to 32 MB. For longer video, upload an extracted or compressed audio track.',
        },
        413,
      );
    throw error;
  }
  if (!bytes.byteLength) return noStoreJson({ error: 'Choose an audio or video file first.' }, 400);

  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(120000)]);
  try {
    const result = await provider.transcribe(bytes, signal);
    return noStoreJson({
      cues: result.cues,
      provider: result.provider || provider.name,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'transcription.failed',
        provider: provider.name,
        bytes: bytes.byteLength,
        message: error instanceof Error ? error.message : 'Unknown transcription error',
      }),
    );
    return noStoreJson(
      {
        error:
          error instanceof Error && /No Japanese speech/i.test(error.message)
            ? error.message
            : 'AI subtitle generation failed. Try a smaller audio file or add subtitles manually.',
      },
      503,
    );
  } finally {
    controller.abort();
  }
}
