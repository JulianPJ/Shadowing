import type { Cue } from './types';
import { mapChunkCues, mergeChunkCues, type TimedChunk } from './media-audio/cues';
import { audioDigest, openTranscriptionCheckpoints } from './media-audio/checkpoint';
import {
  MEDIA_AUDIO_WORKER_URL,
  type MediaAudioCommand,
  type MediaAudioResponse,
  type MediaAudioInfo,
} from './media-audio/types';
import { allocateWave } from './media-audio/wav';

/** A bounded compatibility path for short media on browsers without WebCodecs audio decoding. */
async function prepareShortAudio(file: File, info: MediaAudioInfo, signal: AbortSignal) {
  if (
    file.size > TRANSCRIPTION_UPLOAD_LIMIT ||
    info.end > 120 ||
    info.start !== 0 ||
    info.channels > 2 ||
    info.sampleRate > 48000 ||
    info.audioTracks !== 1 ||
    typeof OfflineAudioContext === 'undefined'
  )
    throw new Error(
      'This browser cannot extract this audio codec. Choose a supported audio track or add subtitles manually.',
    );
  signal.throwIfAborted();
  const context = new OfflineAudioContext(1, 1, 16000);
  // This is the only whole-file read: it is guarded by both a 32 MiB source bound and a two-minute
  // decoded-audio bound. Longer files always stay on the incremental worker path.
  const decoded = await context.decodeAudioData(await file.arrayBuffer());
  signal.throwIfAborted();
  if (
    decoded.sampleRate !== 16000 ||
    decoded.duration > 120 ||
    Math.abs(decoded.duration - info.end) > 0.1
  )
    throw new Error(
      'This browser could not preserve the audio timeline. Choose a supported audio track or add subtitles manually.',
    );
  const { buffer, pcm } = allocateWave(info.end);
  const mono = new Float32Array(pcm.length);
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const samples = decoded.getChannelData(channel);
    for (let frame = 0; frame < Math.min(samples.length, pcm.length); frame++) {
      mono[frame] += samples[frame] / decoded.numberOfChannels;
    }
  }
  for (let frame = 0; frame < mono.length; frame++) {
    const value = Math.max(-1, Math.min(1, mono[frame]));
    pcm[frame] = Math.round(value * (value < 0 ? 32768 : 32767));
  }
  return buffer;
}

export const TRANSCRIPTION_UPLOAD_LIMIT = 32 * 1024 * 1024;
export type TranscriptionProgress = {
  stage: 'extracting' | 'transcribing' | 'resuming';
  completed: number;
  total: number;
  message: string;
};

function delay(ms: number, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort);
      resolve();
    }, ms);
    signal.addEventListener('abort', abort, { once: true });
  });
}

/** Sends one prepared 16 kHz mono WAV window for Whisper subtitles. */
export async function transcribeAudioChunk(
  audio: ArrayBuffer,
  signal: AbortSignal,
  mimeType: 'audio/wav' | 'audio/mp4' = 'audio/wav',
) {
  if (audio.byteLength > TRANSCRIPTION_UPLOAD_LIMIT)
    throw new Error(
      'The prepared audio exceeds the transcription upload limit. Add subtitles manually.',
    );
  // Retry only an explicit rate-limit rejection before inference. A network failure or timeout may
  // already have incurred charges, so leave those retries to a deliberate resume action.
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch('/api/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        ...(mimeType === 'audio/wav' ? { 'X-Hibiki-Audio-Chunk': '1' } : {}),
      },
      body: audio,
      signal: AbortSignal.any([signal, AbortSignal.timeout(150000)]),
    });
    if (response.status === 429 && attempt === 0) {
      const retry = response.headers.get('retry-after');
      const seconds = retry ? Number(retry) : 10;
      const duration = Number.isFinite(seconds)
        ? seconds * 1000
        : Date.parse(retry || '') - Date.now();
      if (duration >= 0 && duration <= 60000) {
        await delay(Math.max(1000, duration), signal);
        continue;
      }
    }
    let result: { cues?: Cue[]; provider?: string; error?: string };
    try {
      result = (await response.json()) as typeof result;
    } catch {
      throw new Error('AI subtitle generation returned an unreadable response.');
    }
    if (!response.ok) {
      if (response.status === 503 && /No Japanese speech was detected/i.test(result.error || ''))
        return { cues: [], provider: result.provider || 'Cloudflare Whisper large-v3-turbo' };
      throw new Error(
        result.error ||
          'AI subtitle generation failed. Reattach the same file to resume completed chunks, or add subtitles manually.',
      );
    }
    if (!Array.isArray(result.cues) || !result.cues.length)
      throw new Error('AI subtitle generation returned no timed Japanese subtitles.');
    return { cues: result.cues, provider: result.provider || 'Cloudflare Whisper large-v3-turbo' };
  }
  throw new Error(
    'AI subtitle generation is busy. Reattach the same file to resume completed chunks.',
  );
}

function audioWorker(signal: AbortSignal) {
  signal.throwIfAborted();
  if (typeof Worker === 'undefined')
    throw new Error('This browser cannot prepare audio for AI subtitles. Add subtitles manually.');
  const worker = new Worker(MEDIA_AUDIO_WORKER_URL);
  const request = (command: MediaAudioCommand, timeoutMs: number) =>
    new Promise<MediaAudioResponse>((resolve, reject) => {
      signal.throwIfAborted();
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        worker.onmessage = null;
        worker.onerror = null;
      };
      const abort = () => {
        cleanup();
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(
          new Error(
            'Audio preparation took too long. Choose a smaller audio track or add subtitles manually.',
          ),
        );
      }, timeoutMs);
      signal.addEventListener('abort', abort, { once: true });
      worker.onmessage = (event: MessageEvent<MediaAudioResponse>) => {
        cleanup();
        if (event.data.type === 'error') reject(new Error(event.data.message));
        else resolve(event.data);
      };
      worker.onerror = () => {
        cleanup();
        reject(
          new Error(
            'This browser could not prepare the audio. Choose a supported audio track or add subtitles manually.',
          ),
        );
      };
      worker.postMessage(command);
    });
  return { worker, request };
}

/** Prepare one window at a time; retain the original File as the native player's source. */
export async function transcribeMediaFile(
  file: File,
  signal: AbortSignal,
  onProgress?: (progress: TranscriptionProgress) => void,
  options: { checkpointScope?: string } = {},
) {
  const { worker, request } = audioWorker(signal);
  try {
    onProgress?.({
      stage: 'extracting',
      completed: 0,
      total: 0,
      message: 'Reading the local audio track…',
    });
    const initialized = await request({ type: 'init', file }, 60000);
    if (initialized.type !== 'ready') throw new Error('The local audio track could not be read.');
    const { total } = initialized.info;
    const checkpoints = await openTranscriptionCheckpoints(file, options.checkpointScope);
    const completed: TimedChunk[] = [];
    let provider = 'Cloudflare Whisper large-v3-turbo';
    for (let index = 0; index < total; index++) {
      signal.throwIfAborted();
      onProgress?.({
        stage: 'extracting',
        completed: index,
        total,
        message: `Preparing audio ${index + 1} of ${total}…`,
      });
      const prepared: MediaAudioResponse =
        initialized.info.nativeDecode || initialized.info.canCopyAudio
          ? await request({ type: 'next' }, 120000)
          : {
              type: 'chunk',
              chunk: {
                index: 0,
                start: initialized.info.start,
                end: initialized.info.end,
                audio: await prepareShortAudio(file, initialized.info, signal),
              },
            };
      if (prepared.type !== 'chunk')
        throw new Error('Audio preparation ended before the media was complete.');
      const chunk = prepared.chunk;
      const digest = await audioDigest(chunk.audio);
      signal.throwIfAborted();
      const saved = checkpoints.load(index, digest, chunk.start, chunk.end);
      if (saved) {
        completed.push({ start: chunk.start, end: chunk.end, cues: saved.cues });
        if (completed.reduce((count, chunk) => count + chunk.cues.length, 0) > 15000)
          mergeChunkCues(completed);
        provider = saved.provider;
        onProgress?.({
          stage: 'resuming',
          completed: index + 1,
          total,
          message: `Reusing completed audio ${index + 1} of ${total}…`,
        });
        if (chunk.end >= initialized.info.end) break;
        continue;
      }
      onProgress?.({
        stage: 'transcribing',
        completed: index,
        total,
        message: `Generating subtitles ${index + 1} of ${total}…`,
      });
      const result = await transcribeAudioChunk(chunk.audio, signal, chunk.mimeType);
      signal.throwIfAborted();
      const cues = result.cues.length ? mapChunkCues(result.cues, chunk.start, chunk.end) : [];
      completed.push({ start: chunk.start, end: chunk.end, cues });
      if (completed.reduce((count, chunk) => count + chunk.cues.length, 0) > 15000)
        mergeChunkCues(completed);
      provider = result.provider;
      checkpoints.save(index, { digest, start: chunk.start, end: chunk.end, cues, provider });
      onProgress?.({
        stage: 'transcribing',
        completed: index + 1,
        total,
        message: `Completed audio ${index + 1} of ${total}.`,
      });
      // AAC windows end on packet boundaries. The final packet can cover a nominal next window
      // of only a few milliseconds; do not request/upload an empty or repeated trailing chunk.
      if (chunk.end >= initialized.info.end) break;
    }
    return { cues: mergeChunkCues(completed), provider };
  } finally {
    worker.terminate();
  }
}

/** Reuse the same bounded codec worker for an accessible local reference, without uploading audio. */
export async function extractMediaAudioRange(
  file: File,
  start: number,
  end: number,
  signal: AbortSignal,
) {
  const { worker, request } = audioWorker(signal);
  try {
    const initialized = await request({ type: 'init', file, range: { start, end } }, 60000);
    if (initialized.type !== 'ready' || !initialized.info.nativeDecode)
      throw new Error('Reference audio extraction is unavailable in this browser.');
    const prepared = await request({ type: 'next' }, 30000);
    if (prepared.type !== 'chunk') throw new Error('This reference audio could not be prepared.');
    return new Blob([prepared.chunk.audio], { type: 'audio/wav' });
  } finally {
    worker.terminate();
  }
}
