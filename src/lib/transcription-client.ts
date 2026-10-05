import type { Cue } from './types';

export const TRANSCRIPTION_UPLOAD_LIMIT = 32 * 1024 * 1024;

export async function transcribeMediaFile(file: File, signal: AbortSignal) {
  if (file.size > TRANSCRIPTION_UPLOAD_LIMIT)
    throw new Error(
      'AI subtitle generation currently supports media up to 32 MB. For longer video, upload an extracted or compressed audio track.',
    );
  const response = await fetch('/api/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': file.type || 'application/octet-stream',
    },
    body: file,
    signal,
  });
  let result: { cues?: Cue[]; provider?: string; error?: string };
  try {
    result = (await response.json()) as typeof result;
  } catch {
    throw new Error('AI subtitle generation returned an unreadable response.');
  }
  if (!response.ok) throw new Error(result.error || 'AI subtitle generation failed.');
  if (!Array.isArray(result.cues) || !result.cues.length)
    throw new Error('AI subtitle generation returned no timed Japanese subtitles.');
  return {
    cues: result.cues,
    provider: result.provider || 'Cloudflare Whisper large-v3-turbo',
  };
}
