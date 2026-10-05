import { Buffer } from 'node:buffer';
import type { TranscriptionProvider, Cue } from '../types';
import { parseSubtitles } from '../subtitles';
import { runWorkersAi, type WorkersAiBindingLike } from './workers-ai';

export const WORKERS_AI_TRANSCRIPTION_MODEL = '@cf/openai/whisper-large-v3-turbo';
export const WORKERS_AI_TRANSCRIPTION_PROVIDER = 'Cloudflare Whisper large-v3-turbo';

type WhisperResult = {
  text?: string;
  vtt?: string;
  segments?: unknown[];
  transcription_info?: { language?: string };
};

export function createWorkersAiTranscriptionProvider(
  ai: WorkersAiBindingLike,
): TranscriptionProvider<Uint8Array<ArrayBuffer>> {
  return {
    name: WORKERS_AI_TRANSCRIPTION_PROVIDER,
    async transcribe(bytes, signal = new AbortController().signal) {
      const result = await runWorkersAi<WhisperResult>(
        ai,
        WORKERS_AI_TRANSCRIPTION_MODEL,
        {
          audio: Buffer.from(bytes).toString('base64'),
          task: 'transcribe',
          language: 'ja',
          vad_filter: true,
          condition_on_previous_text: true,
        },
        signal,
      );
      if (!result || typeof result.vtt !== 'string' || !result.vtt.trim())
        throw new Error('The transcription service did not return timed subtitles.');
      let cues: Cue[];
      try {
        cues = parseSubtitles(result.vtt);
      } catch {
        throw new Error('The transcription service returned invalid subtitle timings.');
      }
      if (!cues.length) throw new Error('No Japanese speech was detected in this media.');
      return { cues, provider: WORKERS_AI_TRANSCRIPTION_PROVIDER };
    },
  };
}
