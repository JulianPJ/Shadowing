'use client';
import { mapChunkCues, mergeChunkCues, type TimedChunk } from '../media-audio/cues';
import { audioChunkWindows } from '../media-audio/types';
import { transcribeAudioChunk, type TranscriptionProgress } from '../transcription-client';
import { validPreparedAudioChunk } from '../transcription-api';
import { timestamp } from '../youtube';
import type { Cue } from '../types';
import { bridgeRequest, onBridgeEvent } from './bridge';

function decodeAudio(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  if (!validPreparedAudioChunk(bytes))
    throw new Error('Hibiki Bridge sent audio Hibiki cannot read. Update the extension and retry.');
  return bytes.buffer;
}

/**
 * Whisper subtitles for a video on another page. The extension plays the video at normal speed
 * from the start and hands over 16 kHz audio windows (116 s, overlapping by 4 s) as playback
 * passes them; each window is transcribed while the next is still playing. Finishing early keeps
 * what was heard so far.
 */
export function transcribePageAudio(
  tabId: number,
  duration: number,
  signal: AbortSignal,
  onProgress?: (progress: TranscriptionProgress) => void,
): Promise<{ cues: Cue[]; provider: string }> {
  const windows = audioChunkWindows(0, duration);
  const total = windows.length;
  const completed: TimedChunk[] = [];
  let provider = 'Cloudflare Whisper large-v3-turbo';
  let transcribing = Promise.resolve();
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let settled = false;
    let unsubscribe = () => {};
    const abort = () => finish(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      unsubscribe();
      signal.removeEventListener('abort', abort);
      if (error) {
        void bridgeRequest('capture-stop', { tabId }).catch(() => {});
        reject(error);
        return;
      }
      try {
        resolve({ cues: mergeChunkCues(completed.sort((a, b) => a.start - b.start)), provider });
      } catch {
        reject(
          new Error('No Japanese speech was heard yet. Let the video play longer, then finish.'),
        );
      }
    };
    signal.addEventListener('abort', abort, { once: true });
    unsubscribe = onBridgeEvent((event) => {
      if (event.tabId !== tabId || settled) return;
      switch (event.event) {
        case 'media-state':
          if (!event.data.paused)
            onProgress?.({
              stage: 'extracting',
              completed: completed.length,
              total,
              message: `Listening along · ${timestamp(event.data.currentTime)} of ${timestamp(duration)}`,
            });
          break;
        case 'capture-chunk': {
          const { start, end, audio } = event.data;
          transcribing = transcribing.then(async () => {
            if (settled) return;
            const result = await transcribeAudioChunk(decodeAudio(audio), signal);
            const cues = result.cues.length ? mapChunkCues(result.cues, start, end) : [];
            completed.push({ start, end, cues });
            provider = result.provider;
            onProgress?.({
              stage: 'transcribing',
              completed: completed.length,
              total,
              message: `Subtitled ${timestamp(end)} of ${timestamp(duration)}`,
            });
          });
          transcribing.catch(finish);
          break;
        }
        case 'capture-end':
          void transcribing.then(() => finish(), finish);
          break;
        case 'capture-error':
          finish(new Error(event.data.message));
          break;
        case 'tab-closed':
          finish(new Error('The video tab was closed. Open it again to continue.'));
          break;
      }
    });
    bridgeRequest('capture-start', { tabId, windows }).catch(finish);
  });
}

/** Stops listening; the windows heard so far are still transcribed and returned. */
export function finishPageCapture(tabId: number) {
  return bridgeRequest('capture-stop', { tabId });
}
