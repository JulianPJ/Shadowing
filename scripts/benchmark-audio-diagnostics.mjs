import { analyzeAudioDiagnostics } from '../src/lib/audio-diagnostics.ts';

// Run with: node --import tsx scripts/benchmark-audio-diagnostics.mjs
// Synthetic CPU workload only; this does not validate Japanese speech quality.
const rate = 16000;
const left = new Float32Array(60 * rate);
const right = new Float32Array(left.length);
for (let sample = 0; sample < left.length; sample++) {
  const time = sample / rate;
  const gain = time % 1 < 0.7 ? 0.15 : 0.0005;
  left[sample] = gain * Math.sin(2 * Math.PI * 220 * time);
  right[sample] = left[sample] * 0.7;
}
const coldStart = performance.now();
const result = analyzeAudioDiagnostics([left, right], rate);
const coldMs = performance.now() - coldStart;
const times = [];
for (let run = 0; run < 20; run++) {
  const start = performance.now();
  analyzeAudioDiagnostics([left, right], rate);
  times.push(performance.now() - start);
}
times.sort((left, right) => left - right);
console.log(
  JSON.stringify(
    {
      durationSeconds: 60,
      channels: 2,
      inputPcmBytes: left.byteLength + right.byteLength,
      coldMs,
      warmP50Ms: times[10],
      warmP95Ms: times[18],
      energyEnvelopePoints: result.energyEnvelope.length,
    },
    null,
    2,
  ),
);
