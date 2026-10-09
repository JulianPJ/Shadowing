export const AUDIO_SAMPLE_RATE = 16000;
// Each window re-hears the last few seconds of the previous one, so an utterance cut at a chunk
// boundary is transcribed whole by the next chunk (see mergeChunkCues). Windows stay at most
// 120 s, within the bounded WAV and server limits.
export const AUDIO_CHUNK_SECONDS = 116;
export const AUDIO_OVERLAP_SECONDS = 4;
export const MAX_TRANSCRIPTION_SECONDS = 4 * 60 * 60;
export const MEDIA_AUDIO_WORKER_URL = '/furigana/v1/media-audio-worker.js';

export type PreparedAudioChunk = {
  index: number;
  start: number;
  end: number;
  audio: ArrayBuffer;
  mimeType?: 'audio/wav' | 'audio/mp4';
};

export type MediaAudioInfo = {
  start: number;
  end: number;
  total: number;
  trackName: string | null;
  language: string;
  nativeDecode: boolean;
  channels: number;
  sampleRate: number;
  audioTracks: number;
  canCopyAudio: boolean;
};

export type MediaAudioCommand =
  { type: 'init'; file: File; range?: { start: number; end: number } } | { type: 'next' };
export type MediaAudioResponse =
  | { type: 'ready'; info: MediaAudioInfo }
  | { type: 'chunk'; chunk: PreparedAudioChunk }
  | { type: 'done' }
  | { type: 'error'; message: string };

export function audioChunkWindows(start: number, end: number) {
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start)
    throw new Error('This media does not have a finite, readable audio timeline.');
  if (end > 86400 || end - start > MAX_TRANSCRIPTION_SECONDS)
    throw new Error(
      'Generate subtitles from an audio track of up to four hours, or add subtitles manually.',
    );
  const windows: { index: number; start: number; end: number }[] = [];
  for (let cursor = start; cursor < end; cursor += AUDIO_CHUNK_SECONDS) {
    windows.push({
      index: windows.length,
      start: Math.max(start, cursor - (windows.length ? AUDIO_OVERLAP_SECONDS : 0)),
      end: Math.min(end, cursor + AUDIO_CHUNK_SECONDS),
    });
  }
  return windows;
}
