import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleShadowingFeedbackRequest,
  handleShadowingSummaryRequest,
  handleShadowingTranscriptionRequest,
} from '../src/lib/shadowing-api';
import {
  createWorkersAiShadowingProvider,
  SHADOWING_WHISPER_MODEL,
  ShadowingProviderError,
  type ShadowingFeedbackProvider,
} from '../src/lib/providers/shadowing';
import type { ShadowingSummarySignals } from '../src/lib/shadowing-session';

const webmHeader = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]);

test('Whisper scoring transcription is Japanese/VAD and never receives the target sentence as a prompt', async () => {
  const seen: Record<string, unknown>[] = [];
  const provider = createWorkersAiShadowingProvider({
    async run(model, input) {
      if (model === SHADOWING_WHISPER_MODEL) {
        seen.push(input);
        return {
          text: '今日は天気がいいです',
          vtt: 'WEBVTT\n\n00:00.000 --> 00:02.000\n今日は天気がいいです',
        };
      }
      throw new Error('unexpected model');
    },
  });
  const result = await provider.transcribe(
    new Uint8Array([1, 2, 3]),
    new AbortController().signal,
  );
  assert.equal(result.recognizedText, '今日は天気がいいです');
  const whisperInput = seen[0];
  assert.ok(whisperInput);
  assert.equal(whisperInput.language, 'ja');
  assert.equal(whisperInput.task, 'transcribe');
  assert.equal(whisperInput.vad_filter, true);
  assert.equal(whisperInput.condition_on_previous_text, false);
  assert.equal('initial_prompt' in whisperInput, false);
  assert.equal('prefix' in whisperInput, false);
});

function mockProvider(): ShadowingFeedbackProvider {
  return {
    name: 'mock',
    async transcribe() {
      return {
        recognizedText: '今日は天気がいいです',
        speechStart: 0,
        speechEnd: 2,
        provider: 'mock',
      };
    },
    async feedback(input) {
      assert.equal(input.score, 87);
      return ['The ending was not recognised clearly.'];
    },
    async summary(input) {
      assert.equal(input.score, 86);
      return { wentWell: 'Recognition was strong.', keepWorking: 'Keep the endings clear.' };
    },
  };
}

test('header-only Whisper VTT is classified as no speech rather than malformed', async () => {
  const provider = createWorkersAiShadowingProvider({
    async run(model) {
      assert.equal(model, SHADOWING_WHISPER_MODEL);
      return { text: '', vtt: 'WEBVTT\n\n' };
    },
  });
  await assert.rejects(
    () => provider.transcribe(new Uint8Array([1, 2, 3]), new AbortController().signal),
    (error: unknown) =>
      error instanceof ShadowingProviderError && error.code === 'no-speech',
  );
});

test('transcription endpoint validates origin, audio type, duration and size before inference', async () => {
  let calls = 0;
  const provider = mockProvider();
  const wrapped = { ...provider, transcribe: async (...args: Parameters<typeof provider.transcribe>) => {
    calls++;
    return provider.transcribe(...args);
  }};
  const wrongOrigin = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: {
        Origin: 'https://evil.example',
        'Content-Type': 'audio/webm',
        'X-Hibiki-Recording-Duration-Ms': '2000',
      },
      body: webmHeader,
    }),
    wrapped,
  );
  assert.equal(wrongOrigin.status, 403);
  const short = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'X-Hibiki-Recording-Duration-Ms': '200',
      },
      body: webmHeader,
    }),
    wrapped,
  );
  assert.equal(short.status, 422);
  const badType = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'X-Hibiki-Recording-Duration-Ms': '2000',
      },
      body: 'audio',
    }),
    wrapped,
  );
  assert.equal(badType.status, 415);
  const mislabeled = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'X-Hibiki-Recording-Duration-Ms': '2000',
      },
      body: new Uint8Array([1, 2, 3, 4]),
    }),
    wrapped,
  );
  assert.equal(mislabeled.status, 415);
  assert.equal((await mislabeled.json()).code, 'invalid-audio');
  assert.equal(calls, 0);
});

test('successful recording returns only structured transcription metadata', async () => {
  const response = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm;codecs=opus',
        'X-Hibiki-Recording-Duration-Ms': '2000',
      },
      body: webmHeader,
    }),
    mockProvider(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    recognizedText: '今日は天気がいいです',
    speechStart: 0,
    speechEnd: 2,
    provider: 'mock',
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('silence/no recognised speech returns retry state rather than a score', async () => {
  const provider = mockProvider();
  provider.transcribe = async () => {
    throw new ShadowingProviderError('no-speech', 'No meaningful Japanese speech was recognised.');
  };
  const response = await handleShadowingTranscriptionRequest(
    new Request('https://hibiki.example/api/shadowing/transcribe', {
      method: 'POST',
      headers: {
        'Content-Type': 'audio/webm',
        'X-Hibiki-Recording-Duration-Ms': '2000',
      },
      body: webmHeader,
    }),
    provider,
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).code, 'no-speech');
});

test('Qwen receives deterministic pace band instead of reinterpreting raw speed', async () => {
  let sent: Record<string, unknown> | undefined;
  const provider = createWorkersAiShadowingProvider({
    async run(model, input) {
      assert.notEqual(model, SHADOWING_WHISPER_MODEL);
      sent = input;
      return { response: { suggestions: ['Keep the ending audible.'] } };
    },
  });
  await provider.feedback(
    {
      targetText: '今日は天気がいいですね',
      recognizedText: '今日は天気がいいです',
      alignment: [{ type: 'deletion', expected: 'ね' }],
      missing: ['ね'],
      substitutions: [],
      additions: [],
      contentScore: 91,
      timingScore: 94,
      score: 92,
      relativeSpeakingSpeed: 0.96,
    },
    new AbortController().signal,
  );
  const messages = sent?.messages;
  assert.ok(Array.isArray(messages));
  const user = messages.find(
    (message): message is { role: string; content: string } =>
      !!message &&
      typeof message === 'object' &&
      (message as { role?: unknown }).role === 'user' &&
      typeof (message as { content?: unknown }).content === 'string',
  );
  assert.ok(user);
  const payload = JSON.parse(user.content.replace('\n/no_think', '')) as Record<string, unknown>;
  assert.equal(payload.pace, 'close');
  assert.equal('relativeSpeakingSpeed' in payload, false);
});

test('Qwen feedback receives but cannot replace the deterministic score', async () => {
  const response = await handleShadowingFeedbackRequest(
    new Request('https://hibiki.example/api/shadowing/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetText: '今日は天気がいいですね',
        recognizedText: '今日は天気がいいです',
        alignment: [{ type: 'deletion', expected: 'ね' }],
        missing: ['ね'],
        substitutions: [],
        additions: [],
        contentScore: 84,
        timingScore: 99,
        score: 87,
        relativeSpeakingSpeed: 0.95,
      }),
    }),
    mockProvider(),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.suggestions, ['The ending was not recognised clearly.']);
  assert.equal('score' in body, false);
});

test('end summary receives aggregate structured data rather than audio', async () => {
  const signals: ShadowingSummarySignals = {
    score: 86,
    scoredSections: 2,
    totalSections: 3,
    averageContentScore: 88,
    averageTimingScore: 80,
    fingerprint: 's1:81|s2:90',
    pace: { faster: 0, slower: 1, close: 1 },
    commonDeletions: [{ value: 'ね', count: 1 }],
    commonAdditions: [],
    commonSubstitutions: [],
    highest: [{ sectionId: 's2', score: 90 }],
    lowest: [{ sectionId: 's1', score: 81 }],
  };
  const response = await handleShadowingSummaryRequest(
    new Request('https://hibiki.example/api/shadowing/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signals),
    }),
    mockProvider(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    wentWell: 'Recognition was strong.',
    keepWorking: 'Keep the endings clear.',
    provider: 'Qwen',
  });
});
