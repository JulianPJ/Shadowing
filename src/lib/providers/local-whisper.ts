import type { TranscriptionProvider, Cue } from '../types';
export const localWhisper: TranscriptionProvider<File> = {
  name: 'Local Whisper',
  async transcribe(file, signal) {
    const endpoint = process.env.NEXT_PUBLIC_WHISPER_URL;
    if (!endpoint)
      throw new Error('Local transcription is not configured. Import a subtitle file instead.');
    const body = new FormData();
    body.append('file', file);
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/transcribe`, {
      method: 'POST',
      body,
      signal,
    });
    if (!response.ok)
      throw new Error(
        'Local transcription failed. Check that the Whisper service is running, or import subtitles.',
      );
    return (await response.json()) as { cues: Cue[] };
  },
};
