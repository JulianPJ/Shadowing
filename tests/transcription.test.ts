import { Buffer } from 'node:buffer';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkersAiTranscriptionProvider,
  WORKERS_AI_TRANSCRIPTION_MODEL,
  WORKERS_AI_TRANSCRIPTION_PROVIDER,
} from '../src/lib/providers/ai-transcription';
import { handleTranscriptionRequest, validPreparedAudioChunk } from '../src/lib/transcription-api';
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
        vtt: 'WEBVTT\n\n00.280 --> 02.500\nおはようございます。',
      };
    },
  });
  const result = await provider.transcribe(new Uint8Array([1, 2, 3]), new AbortController().signal);
  assert.equal(called, 1);
  assert.equal(result.provider, WORKERS_AI_TRANSCRIPTION_PROVIDER);
  assert.deepEqual(
    result.cues.map(({ start, end, text }) => ({ start, end, text })),
    [{ start: 0.28, end: 2.5, text: 'おはようございます。' }],
  );
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

function preparedWave(seconds: number) {
  const bytes = new Uint8Array(44 + Math.round(seconds * 16000) * 2);
  const view = new DataView(bytes.buffer);
  const tag = (offset: number, value: string) =>
    [...value].forEach((character, index) => (bytes[offset + index] = character.charCodeAt(0)));
  tag(0, 'RIFF');
  view.setUint32(4, bytes.length - 8, true);
  tag(8, 'WAVE');
  tag(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  tag(36, 'data');
  view.setUint32(40, bytes.length - 44, true);
  return bytes;
}

test('prepared audio parts enforce their encoded format and duration before paid inference', async () => {
  let calls = 0;
  const provider: TranscriptionProvider<Uint8Array<ArrayBuffer>> = {
    name: 'mock whisper',
    async transcribe() {
      calls++;
      return { cues: [{ start: 0, end: 1, text: '日本語です。' }] };
    },
  };
  const request = (bytes: Uint8Array<ArrayBuffer>, origin = 'https://app.example') =>
    new Request('https://app.example/api/transcribe', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'audio/wav',
        'X-Hibiki-Audio-Chunk': '1',
      },
      body: bytes,
    });
  const valid = preparedWave(122);
  assert.equal(validPreparedAudioChunk(valid), true);
  assert.equal((await handleTranscriptionRequest(request(valid), provider)).status, 200);
  assert.equal(
    (await handleTranscriptionRequest(request(preparedWave(126)), provider)).status,
    422,
  );
  const corrupted = preparedWave(1);
  new DataView(corrupted.buffer).setUint32(24, 48000, true);
  assert.equal((await handleTranscriptionRequest(request(corrupted), provider)).status, 422);
  assert.equal(
    (await handleTranscriptionRequest(request(valid, 'https://other.example'), provider)).status,
    403,
  );
  assert.equal(calls, 1);
});

test('silent audio parts are distinguished from malformed timed transcription output', async () => {
  const silent = createWorkersAiTranscriptionProvider({
    async run() {
      return { text: '', vtt: 'WEBVTT\n\n', segments: [] };
    },
  });
  const response = await handleTranscriptionRequest(
    new Request('https://app.example/api/transcribe', {
      method: 'POST',
      headers: { 'Content-Type': 'audio/wav', 'X-Hibiki-Audio-Chunk': '1' },
      body: preparedWave(1),
    }),
    silent,
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /No Japanese speech was detected/);
  const malformed = createWorkersAiTranscriptionProvider({
    async run() {
      return { text: '日本語です。', vtt: 'WEBVTT' };
    },
  });
  await assert.rejects(malformed.transcribe(preparedWave(1)), /invalid subtitle timings/);
  const missingRecognition = createWorkersAiTranscriptionProvider({
    async run() {
      return { vtt: 'WEBVTT' };
    },
  });
  await assert.rejects(missingRecognition.transcribe(preparedWave(1)), /invalid subtitle timings/);
});
