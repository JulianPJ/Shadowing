import {
  AUDIO_DIAGNOSTICS_MAX_BYTES,
  AUDIO_DIAGNOSTICS_MAX_SECONDS,
  AUDIO_DIAGNOSTICS_SAMPLE_RATE,
  type AudioDiagnostics,
} from './audio-diagnostics';

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Local analysis cancelled.', 'AbortError');
}

/** Only short microphone recordings. Long media must use the incremental import pipeline. */
export async function recordingAudioDiagnostics(
  recording: Blob,
  recordingDurationSeconds: number,
  signal: AbortSignal,
  playbackSpeed = 1,
): Promise<AudioDiagnostics> {
  throwIfAborted(signal);
  if (typeof OfflineAudioContext === 'undefined' || typeof Worker === 'undefined')
    throw new Error(
      'Local recording checks are unavailable in this browser. You can still listen back.',
    );
  if (!recording.size || recording.size > AUDIO_DIAGNOSTICS_MAX_BYTES)
    throw new Error('This recording is too large for a local check. Try a shorter recording.');
  if (
    !Number.isFinite(recordingDurationSeconds) ||
    recordingDurationSeconds <= 0 ||
    recordingDurationSeconds > AUDIO_DIAGNOSTICS_MAX_SECONDS ||
    !Number.isFinite(playbackSpeed) ||
    playbackSpeed < 0.5 ||
    playbackSpeed > 2 ||
    recordingDurationSeconds / playbackSpeed > AUDIO_DIAGNOSTICS_MAX_SECONDS
  )
    throw new Error(
      'Local recording checks support recordings up to one minute. Try a shorter recording.',
    );

  // Native decoder resamples before copying bounded PCM into the worker. Offline decoding
  // opens neither an output device nor another microphone stream.
  const context = new OfflineAudioContext(1, 1, AUDIO_DIAGNOSTICS_SAMPLE_RATE);
  const bytes = await recording.arrayBuffer();
  throwIfAborted(signal);
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(bytes);
  } catch {
    throwIfAborted(signal);
    throw new Error(
      'This browser could not decode the recording for a local check. You can still listen back.',
    );
  }
  throwIfAborted(signal);
  if (
    !decoded.length ||
    !Number.isFinite(decoded.duration) ||
    decoded.duration > AUDIO_DIAGNOSTICS_MAX_SECONDS ||
    decoded.duration / playbackSpeed > AUDIO_DIAGNOSTICS_MAX_SECONDS ||
    decoded.numberOfChannels > 2
  )
    throw new Error('Local recording checks support short mono or stereo recordings.');

  const channels: Float32Array<ArrayBuffer>[] = [];
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const source = decoded.getChannelData(channel);
    const samples = new Float32Array(source.length);
    // Yield between bounded copies so cancelling or replaying stays responsive.
    for (let offset = 0; offset < source.length; offset += 65536) {
      throwIfAborted(signal);
      samples.set(source.subarray(offset, offset + 65536), offset);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    channels.push(samples);
  }
  throwIfAborted(signal);
  return new Promise<AudioDiagnostics>((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker('/furigana/v1/audio-diagnostics-worker.js');
    } catch {
      reject(new Error('Local recording checks are unavailable. You can still listen back.'));
      return;
    }
    const timer = setTimeout(
      () => finish(new Error('Local recording check timed out. Please try again.')),
      15000,
    );
    const abort = () => finish(new DOMException('Local analysis cancelled.', 'AbortError'));
    function finish(error?: Error, result?: AudioDiagnostics) {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    }
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () =>
      finish(new Error('Local recording check failed. You can still listen back.'));
    worker.onmessage = ({ data }: MessageEvent<{ result?: AudioDiagnostics; error?: boolean }>) => {
      if (data.error || !data.result)
        finish(new Error('Local recording check failed. You can still listen back.'));
      else finish(undefined, data.result);
    };
    try {
      worker.postMessage(
        // Interpret reference samples on the selected playback clock, so the same pause
        // thresholds apply to both the source and a learner's normal-speed recording.
        { channels, sampleRate: decoded.sampleRate * playbackSpeed },
        channels.map((channel) => channel.buffer),
      );
    } catch {
      finish(new Error('Local recording check failed. You can still listen back.'));
    }
  });
}
