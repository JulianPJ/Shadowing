import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SHADOWING_SCORE_CONSTANTS,
  ShadowingScoreError,
  scoreShadowingAttempt,
  type ShadowingSectionResult,
} from '../src/lib/shadowing-score';
import {
  aggregateShadowingScores,
  createShadowingSession,
  shadowingSummarySignals,
  upsertShadowingSection,
} from '../src/lib/shadowing-session';

const score = (
  targetText: string,
  recognizedText: string,
  recordingDurationSeconds = 4,
  referenceDurationSeconds = 4,
  readings?: { target: string; heard: string },
) =>
  scoreShadowingAttempt({
    targetText,
    recognizedText,
    recordingDurationSeconds,
    referenceDurationSeconds,
    ...(readings
      ? { targetReading: readings.target, recognizedReading: readings.heard }
      : {}),
  });

test('exact transcript match with matched timing scores 100', () => {
  const result = score('今日は天気がいいですね', '今日は天気がいいですね');
  assert.equal(result.contentScore, 100);
  assert.equal(result.timingScore, 100);
  assert.equal(result.score, 100);
});

test('punctuation and whitespace-only differences are effectively exact', () => {
  const result = score('今日は、天気がいいですね。', ' 今日は天気がいいですね！ ');
  assert.equal(result.contentScore, 100);
  assert.equal(result.score, 100);
});

test('kana and kanji spellings are equivalent when local readings are available', () => {
  const result = score('今日は学校へ行きます', 'きょうはがっこうへいきます', 4, 4, {
    target: 'きょうはがっこうへいきます',
    heard: 'きょうはがっこうへいきます',
  });
  assert.equal(result.normalization, 'reading');
  assert.equal(result.contentScore, 100);
  assert.equal(result.score, 100);
});

test('missing ending, substitution, and insertion receive deterministic content penalties', () => {
  const missing = score('今日は天気がいいですね', '今日は天気がいいです');
  const substitution = score('公園へ行きます', '公園へ帰ります');
  const insertion = score('朝ごはんを食べます', '朝ごはんをゆっくり食べます');
  assert.ok(missing.contentScore < 100);
  assert.ok(missing.missing.length + missing.substitutions.length > 0);
  assert.ok(substitution.substitutions.length > 0);
  assert.ok(substitution.contentScore < 100);
  assert.ok(insertion.additions.length > 0);
  assert.ok(insertion.contentScore < 100);
});

test('completely different sentence is low even with matched timing', () => {
  const result = score('今日は天気がいいですね', '昨日は電車で大阪へ行きました');
  assert.ok(result.contentScore <= 25);
  assert.ok(result.score <= 40);
});

test('empty recognised transcript is invalid and produces no score', () => {
  assert.throws(
    () => score('今日は天気がいいですね', ''),
    (error) => error instanceof ShadowingScoreError && error.code === 'no-speech',
  );
});

test('vastly short recording is invalid before a misleading score can be produced', () => {
  assert.throws(
    () => score('今日は天気がいいですね', '今日は天気がいいですね', 0.7, 4),
    (error) => error instanceof ShadowingScoreError && error.code === 'recording-too-short',
  );
  assert.equal(SHADOWING_SCORE_CONSTANTS.minimumDurationRatio, 0.25);
});

test('much faster and much slower recordings receive symmetric timing penalties', () => {
  const fast = score('今日は天気がいいですね', '今日は天気がいいですね', 2, 4);
  const slow = score('今日は天気がいいですね', '今日は天気がいいですね', 8, 4);
  assert.ok(fast.timingScore < 50);
  assert.ok(slow.timingScore < 50);
  assert.equal(fast.timingScore, slow.timingScore);
  assert.equal(fast.contentScore, 100);
  assert.equal(slow.contentScore, 100);
});

function result(sectionId: string, value: number): ShadowingSectionResult {
  const analysis = score('今日は天気がいいですね', '今日は天気がいいですね');
  return {
    ...analysis,
    sectionId,
    score: value,
    contentScore: value,
    timingScore: value,
    attemptedAt: '2026-10-05T18:00:00.000Z',
    suggestions: ['Keep the rhythm steady.'],
  };
}

test('aggregate averages latest valid score once per unique section with deterministic rounding', () => {
  let session = createShadowingSession('video-a', 'revision-a');
  session = upsertShadowingSection(session, 'video-a', 'revision-a', result('s1', 62));
  session = upsertShadowingSection(session, 'video-a', 'revision-a', result('s1', 81));
  session = upsertShadowingSection(session, 'video-a', 'revision-a', result('s2', 90));
  assert.deepEqual(aggregateShadowingScores(session, 3), {
    score: 86,
    scoredSections: 2,
    totalSections: 3,
    averageContentScore: 86,
    averageTimingScore: 86,
  });
});

test('failed retry leaves previous valid contribution unchanged', () => {
  let session = createShadowingSession('video-a', 'revision-a');
  session = upsertShadowingSection(session, 'video-a', 'revision-a', result('s1', 81));
  // A failed retry never calls upsertShadowingSection.
  assert.equal(aggregateShadowingScores(session, 3)?.score, 81);
  assert.equal(Object.keys(session.sections).length, 1);
});

test('unattempted sections are excluded; no attempts gives no aggregate; one attempt equals that score', () => {
  const empty = createShadowingSession('video-a', 'revision-a');
  assert.equal(aggregateShadowingScores(empty, 12), null);
  const one = upsertShadowingSection(empty, 'video-a', 'revision-a', result('s7', 73));
  assert.deepEqual(aggregateShadowingScores(one, 12), {
    score: 73,
    scoredSections: 1,
    totalSections: 12,
    averageContentScore: 73,
    averageTimingScore: 73,
  });
});

test('video identity is enforced so scores cannot leak between videos', () => {
  const a = upsertShadowingSection(
    createShadowingSession('video-a', 'revision-a'),
    'video-a',
    'revision-a',
    result('s1', 88),
  );
  const b = createShadowingSession('video-b', 'revision-b');
  assert.equal(aggregateShadowingScores(a, 2)?.score, 88);
  assert.equal(aggregateShadowingScores(b, 2), null);
  assert.throws(() => upsertShadowingSection(a, 'video-b', 'revision-b', result('s2', 90)));
});

test('summary signals are aggregated from latest structured section data, not recordings', () => {
  let session = createShadowingSession('video-a', 'revision-a');
  const first = {
    ...result('s1', 70),
    missing: ['ですね'],
    relativeSpeakingSpeed: 0.75,
  };
  const second = {
    ...result('s2', 90),
    substitutions: [{ expected: 'きょ', heard: 'きゅ' }],
    relativeSpeakingSpeed: 1.25,
  };
  session = upsertShadowingSection(session, 'video-a', 'revision-a', first);
  session = upsertShadowingSection(session, 'video-a', 'revision-a', second);
  const signals = shadowingSummarySignals(session, 4)!;
  assert.equal(signals.score, 80);
  assert.equal(signals.scoredSections, 2);
  assert.equal(signals.pace.slower, 1);
  assert.equal(signals.pace.faster, 1);
  assert.equal(signals.commonDeletions[0].value, 'ですね');
  assert.deepEqual(signals.lowest[0], { sectionId: 's1', score: 70 });
});
