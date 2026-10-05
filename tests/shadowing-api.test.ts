import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkersAiShadowingFeedbackProvider,
  createWorkersAiShadowingTranscriptionProvider,
  WORKERS_AI_SHADOWING_FEEDBACK_MODEL,
  WORKERS_AI_SHADOWING_TRANSCRIPTION_MODEL,
} from '../src/lib/providers/shadowing';
import {
  applyShadowingRateLimit,
  handleShadowingFeedbackRequest,
  handleShadowingTranscriptionRequest,
} from '../src/lib/shadowing-api';
import { scoreShadowingAttempt, type ShadowingScoreAnalysis } from '../src/lib/shadowing-score';

function exactAnalysis(): ShadowingScoreAnalysis {
  const result = scoreShadowingAttempt({
    targetText: '今日は天気がいいですね。',
    recognizedText: '今日は天気がいいですね。',
    targetReading: 'きょうはてんきがいいですね',
    recognizedReading: 'きょうはてんきがいいですね',
    targetDuration: 4,
    speechDuration: 4,
  });
  assert.equal(result.valid, true);
  if (!result.valid) throw new Error('Expected a valid shadowing score.');
  return result.analysis;
}

test('shadowing Whisper is independent: Japanese/VAD configured with no target prompt or prefix', async () => {
  let calls = 0;
  const provider = createWorkersAiShadowingTranscriptionProvider({
    async run(model, input) {
      calls++;
      assert.equal(model, WORKERS_AI_SHADOWING_TRANSCRIPTION_MODEL);
      assert.equal(input.task, 'transcribe');
      assert.equal(input.language, 'ja');
      assert.equal(input.vad_filter, true);
      assert.equal(input.condition_on_previous_text, false);
      assert.equal(input.no_speech_threshold, 0.55);
      assert.equal(input.initial_prompt, undefined);
      assert.equal(input.prefix, undefined);
      assert.deepEqual([...Buffer.from(String(input.audio), 'base64')], [1, 2, 3, 4]);
      return {
        text: '今日は天気がいいです。',
        vtt:
          'WEBVTT\n\n00.420 --> 02.100\n今日は天気が\n\n02.100 --> 03.700\nいいです。',
      };
    },
  });
  const result = await provider.transcribe(
    new Uint8Array([1, 2, 3, 4]),
    new AbortController().signal,
  );
  assert.equal(calls, 1);
  assert.equal(result.recognizedText, '今日は天気がいいです。');
  assert.equal(result.speechStart, 0.42);
  assert.equal(result.speechEnd, 3.7);
  assert.ok(Math.abs(result.speechDuration - 3.28) < 0.0001);
});

test('shadowing transcription API rejects cross-origin, non-audio, tiny audio, and no speech', async () => {
  let calls = 0;
  const provider = {
    name: 'mock whisper',
    async transcribe() {
      calls++;
      return {
        recognizedText: '',
        speechDuration: 0,
        speechStart: 0,
        speechEnd: 0,
        provider: 'mock whisper',
      };
    },
  };
  const crossOrigin = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: { Origin: 'https://evil.example', 'Content-Type': 'audio/webm' },
      body: new Uint8Array(512),
    }),
    provider,
  );
  assert.equal(crossOrigin.status, 403);

  const wrongType = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: new Uint8Array(512),
    }),
    provider,
  );
  assert.equal(wrongType.status, 415);

  const tiny = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: new Uint8Array(64),
    }),
    provider,
  );
  assert.equal(tiny.status, 422);

  const silence = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm' },
      body: new Uint8Array(512),
    }),
    provider,
  );
  assert.equal(silence.status, 422);
  assert.equal((await silence.json()).code, 'no-speech');
  assert.equal(calls, 1);
});

test('Qwen feedback receives deterministic score as data and has no score field in its output schema', async () => {
  const analysis = exactAnalysis();
  let calls = 0;
  const provider = createWorkersAiShadowingFeedbackProvider({
    async run(model, input) {
      calls++;
      assert.equal(model, WORKERS_AI_SHADOWING_FEEDBACK_MODEL);
      const schema = (input.response_format as { json_schema: { properties: Record<string, unknown> } })
        .json_schema;
      assert.deepEqual(Object.keys(schema.properties), ['suggestions']);
      assert.ok(!('score' in schema.properties));
      const messages = input.messages as Array<{ role: string; content: string }>;
      assert.match(messages[0].content, /never recalculate, alter, challenge/);
      assert.match(messages[1].content, /"score":100/);
      return {
        choices: [
          {
            finish_reason: 'stop',
            message: { content: JSON.stringify({ suggestions: ['Very close. Keep the same rhythm.'] }) },
          },
        ],
      };
    },
  });
  const suggestions = await provider.feedback(analysis, new AbortController().signal);
  assert.equal(calls, 1);
  assert.deepEqual(suggestions, ['Very close. Keep the same rhythm.']);

  const response = await handleShadowingFeedbackRequest(
    new Request('https://hibiki.example/api/shadowing/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ analysis }),
    }),
    provider,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { suggestions: ['Very close. Keep the same rhythm.'] });
});

test('shadowing rate limiter blocks excess requests before inference routes run', async () => {
  const request = new Request('https://hibiki.example/api/shadowing/transcribe', {
    method: 'POST',
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
  });
  let key = '';
  const response = await applyShadowingRateLimit(request, {
    async limit(options) {
      key = options.key;
      return { success: false };
    },
  });
  assert.equal(key, '203.0.113.10');
  assert.ok(response);
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '60');
});
