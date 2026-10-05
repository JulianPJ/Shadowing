import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkersAiTranscriptionProvider,
  WORKERS_AI_TRANSCRIPTION_MODEL,
  WORKERS_AI_TRANSCRIPTION_PROVIDER,
} from '../src/lib/providers/ai-transcription';
import { handleTranscriptionRequest } from '../src/lib/transcription-api';
import type { TranscriptionProvider } from '../src/lib/types';

test('Workers AI transcription requests Japanese Whisper and normalizes returned VTT cues', async () => {
  let called = 0;
  const provider = createWorkersAiTranscriptionProvider({
    async run(model, input) {
      called++;
      assert.equal(model, WORKERS_AI_TRANSCRIPTION_MODEL);
      assert.equal(input.language, 'ja');
      assert.equal(input.task, 'transcribe');
      assert.equal(input.vad_filter, true);
      assert.deepEqual([...Buffer.from(String(input.audio), 'base64')], [1, 2, 3]);
      return {
        text: 'おはようございます。',
        vtt: 'WEBVTT\n\n00:00.000 --> 00:02.500\nおはようございます。',
      };
    },
  });
  const result = await provider.transcribe(
    new Uint8Array([1, 2, 3]),
    new AbortController().signal,
  );
  assert.equal(called, 1);
  assert.equal(result.provider, WORKERS_AI_TRANSCRIPTION_PROVIDER);
  assert.deepEqual(result.cues, [{ start: 0, end: 2.5, text: 'おはようございます。' }]);
});

test('transcription API accepts bounded audio/video bytes and returns Hibiki cues', async () => {
  let received: number[] = [];
  const provider: TranscriptionProvider<Uint8Array<ArrayBuffer>> = {
    name: 'mock whisper',
    async transcribe(bytes) {
      received = [...bytes];
      return {
        cues: [{ start: 1, end: 3, text: '日本語です。' }],
        provider: 'mock whisper',
      };
    },
  };
  const response = await handleTranscriptionRequest(
    new Request('https://app.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'video/mp4' },
      body: new Uint8Array([9, 8, 7]),
    }),
    provider,
    10,
  );
  assert.equal(response.status, 200);
  assert.deepEqual(received, [9, 8, 7]);
  assert.deepEqual(await response.json(), {
    cues: [{ start: 1, end: 3, text: '日本語です。' }],
    provider: 'mock whisper',
  });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('transcription API rejects non-media, empty, and oversized requests before inference', async () => {
  let calls = 0;
  const provider: TranscriptionProvider<Uint8Array<ArrayBuffer>> = {
    name: 'must not run',
    async transcribe() {
      calls++;
      return { cues: [] };
    },
  };
  const invalid = await handleTranscriptionRequest(
    new Request('https://app.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'not media',
    }),
    provider,
    3,
  );
  assert.equal(invalid.status, 415);
  const empty = await handleTranscriptionRequest(
    new Request('https://app.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
    }),
    provider,
    3,
  );
  assert.equal(empty.status, 400);
  const large = await handleTranscriptionRequest(
    new Request('https://app.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array([1, 2, 3, 4]),
    }),
    provider,
    3,
  );
  assert.equal(large.status, 413);
  assert.equal(calls, 0);
});
