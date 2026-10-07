/** Conservative signal measurements, not a speech recognizer or pronunciation score. */
export const AUDIO_DIAGNOSTICS_SAMPLE_RATE = 16000;
export const AUDIO_DIAGNOSTICS_MAX_SECONDS = 61;
export const AUDIO_DIAGNOSTICS_MAX_BYTES = 8 * 1024 * 1024;

export type AudioActivitySpan = { start: number; end: number };
export type AudioDiagnostics = {
  activity: 'detected' | 'none' | 'uncertain';
  durationSeconds: number;
  activeSeconds: number;
  activityStart: number | null;
  activityEnd: number | null;
  pauses: AudioActivitySpan[];
  rmsDbfs: number;
  peakDbfs: number;
  clippedFraction: number;
  /** At most 100 RMS values, in dBFS, for a bounded local envelope. */
  energyEnvelope: number[];
};

const FRAME_SECONDS = 0.02;
const MIN_ACTIVITY_FRAMES = 4;
const MAX_BRIDGED_GAP_FRAMES = 3;
const MIN_PAUSE_FRAMES = 9;

function dbfs(value: number) {
  return Math.max(-100, 20 * Math.log10(Math.max(0.00001, value)));
}

export function analyzeAudioDiagnostics(
  channels: readonly Float32Array[],
  sampleRate: number,
): AudioDiagnostics {
  const length = channels[0]?.length ?? 0;
  if (
    !Number.isFinite(sampleRate) ||
    sampleRate < 8000 ||
    sampleRate > 48000 ||
    channels.length < 1 ||
    channels.length > 2 ||
    !length ||
    length > sampleRate * AUDIO_DIAGNOSTICS_MAX_SECONDS ||
    channels.some((channel) => channel.length !== length)
  )
    throw new Error('Recording cannot be measured locally.');

  const frameSize = Math.round(sampleRate * FRAME_SECONDS);
  const levels: number[] = [];
  let totalSquared = 0;
  let peak = 0;
  let clippedSamples = 0;
  for (let start = 0; start < length; start += frameSize) {
    const end = Math.min(length, start + frameSize);
    let squared = 0;
    for (const channel of channels) {
      for (let sample = start; sample < end; sample++) {
        const value = channel[sample];
        if (!Number.isFinite(value)) throw new Error('Invalid recording samples.');
        const magnitude = Math.abs(value);
        peak = Math.max(peak, magnitude);
        if (magnitude >= 0.99) clippedSamples++;
        squared += value * value;
      }
    }
    totalSquared += squared;
    levels.push(Math.sqrt(squared / ((end - start) * channels.length)));
  }

  // Quietest frames estimate a background floor. A steady tone/noisy recording with no
  // separation is deliberately left uncertain, rather than declared to be speech.
  const sorted = [...levels].sort((left, right) => left - right);
  const noiseFloor = sorted[Math.floor((sorted.length - 1) * 0.2)];
  const threshold = Math.max(0.002, noiseFloor * 3);
  const active = levels.map((level) => level >= threshold);

  // Ignore isolated clicks. Close only very short gaps, preserving longer pauses.
  for (let start = 0; start < active.length;) {
    const value = active[start];
    let end = start + 1;
    while (end < active.length && active[end] === value) end++;
    if (value && end - start < MIN_ACTIVITY_FRAMES) active.fill(false, start, end);
    start = end;
  }
  for (let start = 0; start < active.length;) {
    if (active[start]) {
      start++;
      continue;
    }
    let end = start + 1;
    while (end < active.length && !active[end]) end++;
    if (start > 0 && end < active.length && end - start <= MAX_BRIDGED_GAP_FRAMES)
      active.fill(true, start, end);
    start = end;
  }

  const durationSeconds = length / sampleRate;
  const first = active.indexOf(true);
  const last = active.lastIndexOf(true);
  let activeSamples = 0;
  const pauses: AudioActivitySpan[] = [];
  for (let frame = 0; frame < active.length; frame++) {
    if (active[frame]) activeSamples += Math.min(frameSize, length - frame * frameSize);
    else if (frame > first && frame < last) {
      const start = frame;
      while (frame + 1 < last && !active[frame + 1]) frame++;
      if (frame - start + 1 >= MIN_PAUSE_FRAMES)
        pauses.push({ start: start * FRAME_SECONDS, end: (frame + 1) * FRAME_SECONDS });
    }
  }
  const rms = Math.sqrt(totalSquared / (length * channels.length));
  const envelopeSize = Math.min(100, levels.length);
  const energyEnvelope = Array.from({ length: envelopeSize }, (_, index) => {
    const start = Math.floor((index * levels.length) / envelopeSize);
    const end = Math.floor(((index + 1) * levels.length) / envelopeSize);
    let squared = 0;
    for (let frame = start; frame < end; frame++) squared += levels[frame] ** 2;
    return dbfs(Math.sqrt(squared / (end - start)));
  });
  return {
    activity: first >= 0 ? 'detected' : rms >= 0.002 || peak >= 0.01 ? 'uncertain' : 'none',
    durationSeconds,
    activeSeconds: activeSamples / sampleRate,
    activityStart: first < 0 ? null : first * FRAME_SECONDS,
    activityEnd: last < 0 ? null : Math.min(durationSeconds, (last + 1) * FRAME_SECONDS),
    pauses,
    rmsDbfs: dbfs(rms),
    peakDbfs: dbfs(peak),
    clippedFraction: clippedSamples / (length * channels.length),
    energyEnvelope,
  };
}
