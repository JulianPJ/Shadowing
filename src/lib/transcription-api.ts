import { BodyLimitError, readBoundedBytes } from './http-body';
import type { TranscriptionProvider } from './types';

export const TRANSCRIPTION_MEDIA_LIMIT = 32 * 1024 * 1024;

/** Fixed PCM format emitted by the browser's bounded audio preparation worker. */
export function validPreparedAudioChunk(bytes: Uint8Array<ArrayBuffer>): boolean {
  if (bytes.byteLength < 46) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number, value: string) =>
    [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  const samples = bytes.byteLength - 44;
  return (
    tag(0, 'RIFF') &&
    view.getUint32(4, true) === bytes.byteLength - 8 &&
    tag(8, 'WAVE') &&
    tag(12, 'fmt ') &&
    view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 &&
    view.getUint16(22, true) === 1 &&
    view.getUint32(24, true) === 16000 &&
    view.getUint32(28, true) === 32000 &&
    view.getUint16(32, true) === 2 &&
    view.getUint16(34, true) === 16 &&
    tag(36, 'data') &&
    view.getUint32(40, true) === samples &&
    samples % 2 === 0 &&
    samples <= 125 * 32000
  );
}

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
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return noStoreJson({ error: 'Generate subtitles from the Hibiki app.' }, 403);
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
  if (
    request.headers.get('x-hibiki-audio-chunk') &&
    (request.headers.get('x-hibiki-audio-chunk') !== '1' ||
      type !== 'audio/wav' ||
      !validPreparedAudioChunk(bytes))
  )
    return noStoreJson({ error: 'This audio part is invalid. Prepare the media again.' }, 422);

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
