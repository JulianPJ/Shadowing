import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  analyzeAudioDiagnostics,
  AUDIO_DIAGNOSTICS_MAX_SECONDS,
  AUDIO_DIAGNOSTICS_SAMPLE_RATE,
} from '../src/lib/audio-diagnostics';

const sampleRate = AUDIO_DIAGNOSTICS_SAMPLE_RATE;
function signal(seconds: number, spans: { start: number; end: number; gain?: number }[]) {
  const samples = new Float32Array(seconds * sampleRate);
  for (const span of spans) {
    for (
      let sample = Math.round(span.start * sampleRate);
      sample < Math.round(span.end * sampleRate);
      sample++
    )
      samples[sample] = (span.gain ?? 0.15) * Math.sin((2 * Math.PI * 220 * sample) / sampleRate);
  }
  return samples;
}

test('local signal checks preserve activity timing and internal pauses without scoring speech', () => {
  const result = analyzeAudioDiagnostics(
    [
      signal(3, [
        { start: 0.3, end: 1 },
        { start: 1.5, end: 2.5 },
      ]),
    ],
    sampleRate,
  );
  assert.equal(result.activity, 'detected');
  assert.equal(result.durationSeconds, 3);
  assert.ok(Math.abs(result.activeSeconds - 1.7) < 0.021);
  assert.equal(result.activityStart, 0.3);
  assert.equal(result.activityEnd, 2.5);
  assert.deepEqual(result.pauses, [{ start: 1, end: 1.5 }]);
  assert.equal(result.clippedFraction, 0);
  assert.ok(result.energyEnvelope.length <= 100);
  assert.ok(result.energyEnvelope.every(Number.isFinite));
  assert.equal('score' in result, false);
});

test('silence and unseparated background signals do not invent a speech window', () => {
  const silence = analyzeAudioDiagnostics([new Float32Array(sampleRate)], sampleRate);
  assert.equal(silence.activity, 'none');
  assert.equal(silence.activityStart, null);
  assert.equal(silence.activityEnd, null);
  assert.deepEqual(silence.pauses, []);
  assert.equal(silence.rmsDbfs, -100);

  const steady = analyzeAudioDiagnostics([signal(1, [{ start: 0, end: 1 }])], sampleRate);
  assert.equal(steady.activity, 'uncertain');
  assert.equal(steady.activityStart, null);
});

test('quiet activity remains measurable; isolated clicks do not count as a voice window', () => {
  const quiet = analyzeAudioDiagnostics(
    [signal(2, [{ start: 0.5, end: 1.5, gain: 0.01 }])],
    sampleRate,
  );
  assert.equal(quiet.activity, 'detected');
  assert.equal(quiet.activityStart, 0.5);
  assert.equal(quiet.activityEnd, 1.5);
  const click = new Float32Array(sampleRate);
  click[400] = 1;
  const clicked = analyzeAudioDiagnostics([click], sampleRate);
  assert.equal(clicked.activity, 'uncertain');
  assert.equal(clicked.activityStart, null);
  assert.equal(clicked.activeSeconds, 0);
});

test('short gaps are bridged while a real phrase pause remains visible', () => {
  const result = analyzeAudioDiagnostics(
    [
      signal(2, [
        { start: 0.2, end: 0.6 },
        { start: 0.64, end: 1 },
        { start: 1.3, end: 1.8 },
      ]),
    ],
    sampleRate,
  );
  assert.deepEqual(result.pauses, [{ start: 1, end: 1.3 }]);
  assert.ok(Math.abs(result.activeSeconds - 1.3) < 0.021);
});

test('stereo energy and clipping are preserved even when channels have opposite phase', () => {
  const left = signal(2, [{ start: 0.4, end: 1.4 }]);
  const right = Float32Array.from(left, (sample) => -sample);
  left.fill(1, 16000, 16200);
  right.fill(-1, 16000, 16200);
  const result = analyzeAudioDiagnostics([left, right], sampleRate);
  assert.equal(result.activity, 'detected');
  assert.equal(result.peakDbfs, 0);
  assert.ok(Math.abs(result.clippedFraction - 200 / left.length) < 0.00001);
});

test('invalid samples, oversized buffers and unsupported channel/sample-rate bounds are rejected', () => {
  assert.throws(() => analyzeAudioDiagnostics([], sampleRate));
  assert.throws(() => analyzeAudioDiagnostics([new Float32Array(1)], 0));
  assert.throws(() => analyzeAudioDiagnostics([new Float32Array(1)], 96000));
  assert.throws(() => analyzeAudioDiagnostics([new Float32Array([NaN])], sampleRate));
  assert.throws(() => analyzeAudioDiagnostics([new Float32Array([Infinity])], sampleRate));
  assert.throws(() =>
    analyzeAudioDiagnostics([new Float32Array(1), new Float32Array(2)], sampleRate),
  );
  assert.throws(() =>
    analyzeAudioDiagnostics(
      Array.from({ length: 3 }, () => new Float32Array(1)),
      sampleRate,
    ),
  );
  assert.throws(() =>
    analyzeAudioDiagnostics(
      [new Float32Array(sampleRate * (AUDIO_DIAGNOSTICS_MAX_SECONDS + 1))],
      sampleRate,
    ),
  );
});

test('maximum-length recordings return a bounded envelope and pauses', () => {
  const spans = Array.from({ length: 60 }, (_, index) => ({
    start: index + 0.1,
    end: index + 0.7,
  }));
  const result = analyzeAudioDiagnostics([signal(60, spans)], sampleRate);
  assert.equal(result.durationSeconds, 60);
  assert.equal(result.energyEnvelope.length, 100);
  assert.equal(result.pauses.length, 59);
  assert.ok(Math.abs(result.activeSeconds - 36) < 0.1);
});
