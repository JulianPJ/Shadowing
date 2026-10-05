import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  aggregateShadowingScores,
  readingText,
  scoreShadowingAttempt,
  type ScoredShadowingSection,
  type ShadowingScoreAnalysis,
} from '../src/lib/shadowing-score';
import { annotateJapanese, type MorphologicalToken } from '../src/lib/japanese-readings';
import { shadowingSessionKey } from '../src/lib/shadowing-client';
import type { Lesson } from '../src/lib/types';

const require = createRequire(import.meta.url);
let tokenizer: { tokenize: (text: string) => MorphologicalToken[] };
before(async () => {
  tokenizer = await new Promise((resolve, reject) =>
    require('kuromoji')
      .builder({ dicPath: 'node_modules/kuromoji/dict' })
      .build((error: unknown, value: typeof tokenizer) => (error ? reject(error) : resolve(value))),
  );
});
const reading = (text: string) => readingText(text, annotateJapanese(text, tokenizer.tokenize(text)));

function score(target: string, heard: string, targetDuration = 4, speechDuration = 4) {
  return scoreShadowingAttempt({
    targetText: target,
    recognizedText: heard,
    targetReading: reading(target),
    recognizedReading: reading(heard),
    targetDuration,
    speechDuration,
  });
}
function valid(target: string, heard: string, targetDuration = 4, speechDuration = 4) {
  const result = score(target, heard, targetDuration, speechDuration);
  assert.equal(result.valid, true);
  if (!result.valid) throw new Error('Expected a valid shadowing score.');
  return result.analysis;
}
function section(sectionId: string, scoreValue: number): ScoredShadowingSection {
  const analysis: ShadowingScoreAnalysis = {
    ...valid('今日は天気がいいですね。', '今日は天気がいいですね。'),
    score: scoreValue,
    contentScore: scoreValue,
    timingScore: scoreValue,
  };
  return {
    sectionId,
    attemptId: `${sectionId}-${scoreValue}`,
    scoredAt: new Date(1700000000000 + scoreValue).toISOString(),
    analysis,
  };
}

test('exact transcript match produces a perfect deterministic score', () => {
  const analysis = valid('今日は天気がいいですね。', '今日は天気がいいですね。');
  assert.equal(analysis.score, 100);
  assert.equal(analysis.contentScore, 100);
  assert.equal(analysis.timingScore, 100);
  assert.equal(analysis.deletions + analysis.substitutions + analysis.insertions, 0);
});

test('punctuation and whitespace differences are effectively exact', () => {
  const analysis = valid('今日は、天気がいいですね。', ' 今日は天気がいいですね！ ');
  assert.equal(analysis.contentScore, 100);
  assert.equal(analysis.score, 100);
});

test('kanji and kana with equivalent Kuromoji readings compare as equivalent pronunciation', () => {
  const analysis = valid('今日は天気がいいです。', 'きょうはてんきがいいです');
  assert.equal(analysis.contentScore, 100);
});

test('missing ending, substitution, and insertion each receive deterministic content penalties', () => {
  const missing = valid('今日は天気がいいですね。', '今日は天気がいいです。');
  const substitution = valid('今日は公園に行きます。', '今日は学校に行きます。');
  const insertion = valid('今日は公園に行きます。', '今日はちょっと公園に行きます。');
  for (const analysis of [missing, substitution, insertion]) {
    assert.ok(analysis.contentScore < 100);
    assert.ok(analysis.score < 100);
  }
  assert.ok(missing.deletions + missing.substitutions > 0);
  assert.ok(substitution.substitutions + substitution.deletions > 0);
  assert.ok(insertion.insertions > 0);
});

test('completely different sentence scores low rather than being treated as invalid', () => {
  const analysis = valid('今日は公園に行きます。', '明日は家で本を読みます。');
  assert.ok(analysis.score < 55);
});

test('empty recognition and silence are invalid and produce no score', () => {
  const empty = score('今日は天気がいいです。', '', 4, 0);
  assert.equal(empty.valid, false);
  if (!empty.valid) assert.equal(empty.reason, 'no-speech');

  const silence = scoreShadowingAttempt({
    targetText: '今日は天気がいいです。',
    recognizedText: 'あ',
    targetReading: 'きょうはてんきがいいです',
    recognizedReading: 'あ',
    targetDuration: 4,
    speechDuration: 0.1,
  });
  assert.equal(silence.valid, false);
});

test('vastly incomplete short attempt is invalid instead of receiving a misleading low/high score', () => {
  const result = scoreShadowingAttempt({
    targetText: '今日は天気がいいですね。',
    recognizedText: '今日',
    targetReading: 'きょうはてんきがいいですね',
    recognizedReading: 'きょう',
    targetDuration: 6,
    speechDuration: 0.5,
  });
  assert.equal(result.valid, false);
  if (!result.valid) assert.equal(result.reason, 'too-short');
});

test('much faster and much slower speech receive symmetric timing penalties', () => {
  const fast = valid('今日は天気がいいですね。', '今日は天気がいいですね。', 4, 2);
  const slow = valid('今日は天気がいいですね。', '今日は天気がいいですね。', 4, 8);
  assert.equal(fast.contentScore, 100);
  assert.equal(slow.contentScore, 100);
  assert.equal(fast.timingScore, 0);
  assert.equal(slow.timingScore, 0);
  assert.equal(fast.score, 80);
  assert.equal(slow.score, 80);
});

test('aggregate averages latest valid score once per unique section with deterministic rounding', () => {
  const aggregate = aggregateShadowingScores(
    [section('s1', 62), section('s1', 81), section('s2', 90)],
    3,
  );
  assert.ok(aggregate);
  assert.equal(aggregate.score, 86);
  assert.equal(aggregate.scoredSections, 2);
  assert.equal(aggregate.totalSections, 3);
});

test('failed retry leaves previous valid score when no replacement is supplied', () => {
  const aggregate = aggregateShadowingScores([section('s1', 81), section('s2', 90)], 3);
  assert.ok(aggregate);
  assert.equal(aggregate.score, 86);
  assert.equal(aggregate.scoredSections, 2);
});

test('unattempted sections are excluded; no attempts shows no overall score; one attempt equals its section score', () => {
  assert.equal(aggregateShadowingScores([], 4), null);
  const aggregate = aggregateShadowingScores([section('s2', 73)], 4);
  assert.ok(aggregate);
  assert.equal(aggregate.score, 73);
  assert.equal(aggregate.scoredSections, 1);
  assert.equal(aggregate.totalSections, 4);
});

test('session keys isolate different videos and transcript revisions', () => {
  const lesson = (id: string, japanese: string): Pick<Lesson, 'id' | 'segments'> => ({
    id,
    segments: [{ id: 'segment-1', start: 0, end: 2, japanese }],
  });
  const a = shadowingSessionKey(lesson('video-a', '今日は晴れです。'));
  const b = shadowingSessionKey(lesson('video-b', '今日は晴れです。'));
  const revised = shadowingSessionKey(lesson('video-a', '今日は雨です。'));
  assert.notEqual(a, b);
  assert.notEqual(a, revised);
});
