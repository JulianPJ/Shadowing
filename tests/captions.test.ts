import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CaptionError,
  normalizePreparationError,
  logPreparationError,
} from '../src/lib/providers/errors';
import {
  checkPlayerResponse,
  createCaptionRelay,
  createDirectYoutubeCaptions,
  readProviderBody,
  withTranscriptionFallback,
} from '../src/lib/providers/youtube-captions';
import type { TranscriptionProvider } from '../src/lib/types';

const cue = { start: 1, end: 3, text: 'こんにちは。' };
const id = 'IJ6R4u05ppw';

test('separates bot blocking, private videos and genuinely missing Japanese tracks', () => {
  for (const reason of [
    'Sign in to confirm you’re not a bot',
    'ログインして bot ではないことを確認してください',
  ]) {
    assert.throws(
      () => checkPlayerResponse({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason } }),
      (e: unknown) => e instanceof CaptionError && e.code === 'provider-blocked',
    );
  }
  assert.throws(
    () =>
      checkPlayerResponse({
        playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'This video is private' },
      }),
    (e: unknown) => e instanceof CaptionError && e.code === 'video-unavailable',
  );
  assert.throws(
    () =>
      checkPlayerResponse({
        playabilityStatus: { status: 'OK' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'en' }] } },
      }),
    (e: unknown) => e instanceof CaptionError && e.code === 'no-japanese-captions',
  );
  assert.throws(
    () => checkPlayerResponse({}),
    (e: unknown) => e instanceof CaptionError && e.code === 'provider-incompatible',
  );
  assert.throws(
    () =>
      checkPlayerResponse({
        playabilityStatus: { status: 'OK' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: [null as never] } },
      }),
    (e: unknown) => e instanceof CaptionError && e.code === 'provider-incompatible',
  );
});

test('maps errors without exposing provider details and redacts signed URLs in logs', () => {
  const timeout = new DOMException('Internal timeout detail', 'TimeoutError');
  assert.equal(normalizePreparationError(timeout).code, 'network-timeout');
  assert.equal(normalizePreparationError(new Error('unexpected')).code, 'internal');
  const ambiguous = new Error('No transcripts available');
  ambiguous.name = 'YoutubeTranscriptNotAvailableError';
  assert.equal(normalizePreparationError(ambiguous).code, 'provider-incompatible');
  const entries: string[] = [];
  const previous = console.error;
  try {
    console.error = (value: string) => {
      entries.push(value);
    };
    const mapped = logPreparationError(
      new CaptionError('provider-blocked', 'Rejected https://example.com/?token=secret', 'player'),
      { stage: 'captions', provider: 'youtube-transcript-plus', videoId: id },
    );
    assert.equal(mapped.code, 'provider-blocked');
    assert.ok(!mapped.error.includes('secret'));
    assert.ok(!entries[0].includes('secret'));
    assert.equal(JSON.parse(entries[0]).stage, 'player');
    assert.equal(JSON.parse(entries[0]).aborted, false);
  } finally {
    console.error = previous;
  }
});

test('falls back once on infrastructure errors and keeps the normalized contract/provenance', async () => {
  const calls: string[] = [];
  const primary: TranscriptionProvider = {
    name: 'direct',
    async transcribe() {
      calls.push('direct');
      throw new CaptionError('provider-blocked', 'blocked', 'player');
    },
  };
  const fallback: TranscriptionProvider = {
    name: 'relay',
    async transcribe() {
      calls.push('relay');
      return { cues: [cue] };
    },
  };
  const result = await withTranscriptionFallback([primary, fallback]).transcribe(id);
  assert.deepEqual(calls, ['direct', 'relay']);
  assert.deepEqual(result.cues, [cue]);
  assert.equal(result.provider, 'relay');
});

test('content errors, internal bugs and caller cancellation never trigger fallback', async () => {
  for (const code of ['no-japanese-captions', 'video-unavailable', 'internal'] as const) {
    let calls = 0;
    const primary: TranscriptionProvider = {
      name: 'primary',
      async transcribe() {
        throw new CaptionError(code, 'failure', 'player');
      },
    };
    const fallback: TranscriptionProvider = {
      name: 'fallback',
      async transcribe() {
        calls++;
        return { cues: [cue] };
      },
    };
    await assert.rejects(withTranscriptionFallback([primary, fallback]).transcribe(id));
    assert.equal(calls, 0);
  }
  const controller = new AbortController();
  let fallbackCalls = 0;
  const primary: TranscriptionProvider = {
    name: 'primary',
    async transcribe() {
      controller.abort();
      throw controller.signal.reason;
    },
  };
  const fallback: TranscriptionProvider = {
    name: 'fallback',
    async transcribe() {
      fallbackCalls++;
      return { cues: [cue] };
    },
  };
  await assert.rejects(
    withTranscriptionFallback([primary, fallback]).transcribe(id, controller.signal),
  );
  assert.equal(fallbackCalls, 0);
});

test('library adapter detects HTTP 200 bot response before library mislabels it as missing captions', async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (url) => {
    calls.push(String(url));
    return calls.length === 1
      ? new Response('"INNERTUBE_API_KEY":"test-key"')
      : Response.json({
          playabilityStatus: {
            status: 'LOGIN_REQUIRED',
            reason: 'Sign in to confirm you’re not a bot',
          },
        });
  };
  await assert.rejects(
    createDirectYoutubeCaptions(fakeFetch).transcribe(id),
    (e: unknown) =>
      e instanceof CaptionError && e.code === 'provider-blocked' && e.stage === 'player',
  );
  assert.equal(calls.length, 2);
});

test('library adapter retrieves and normalizes real XML format without retries', async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async () => {
    calls++;
    if (calls === 1) return new Response('"INNERTUBE_API_KEY":"test-key"');
    if (calls === 2)
      return Response.json({
        playabilityStatus: { status: 'OK' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { languageCode: 'ja', baseUrl: 'https://www.youtube.com/api/timedtext?v=' + id },
            ],
          },
        },
        videoDetails: { title: 'Lesson', author: 'Author' },
      });
    return new Response('<transcript><text start="1" dur="2">こんにちは。</text></transcript>');
  };
  const result = await createDirectYoutubeCaptions(fakeFetch).transcribe(id);
  assert.deepEqual(result.cues, [{ ...cue, translation: undefined, estimated: false }]);
  assert.equal(result.title, 'Lesson');
  assert.equal(calls, 3);
});

test('relay authenticates server-side, rejects mismatched/invalid data and preserves content errors', async () => {
  const fetchImpl: typeof fetch = async (url, options) => {
    assert.equal(String(url), 'https://captions.example/captions');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer test-secret');
    assert.deepEqual(JSON.parse(String(options?.body)), { videoId: id });
    assert.equal(options?.redirect, 'manual');
    return Response.json({ videoId: id, cues: [cue] });
  };
  assert.deepEqual(
    (await createCaptionRelay('https://captions.example', 'test-secret', fetchImpl).transcribe(id))
      .cues,
    [{ ...cue, translation: undefined, estimated: false }],
  );
  for (const payload of [
    { videoId: 'another', cues: [cue] },
    { videoId: id, cues: [{ ...cue, end: 0 }] },
  ]) {
    await assert.rejects(
      createCaptionRelay('https://captions.example', 'secret', async () =>
        Response.json(payload),
      ).transcribe(id),
      (e: unknown) => e instanceof CaptionError && e.code === 'provider-incompatible',
    );
  }
  await assert.rejects(
    createCaptionRelay('https://captions.example', 'secret', async () =>
      Response.json({ code: 'no-japanese-captions' }, { status: 422 }),
    ).transcribe(id),
    (e: unknown) => e instanceof CaptionError && e.code === 'no-japanese-captions',
  );
  await assert.rejects(
    createCaptionRelay(
      'https://captions.example',
      'secret',
      async () =>
        new Response(null, { status: 302, headers: { Location: 'https://other.example' } }),
    ).transcribe(id),
    (e: unknown) => e instanceof CaptionError && e.code === 'provider-incompatible',
  );
});

test('bounds upstream payloads and cancels oversized streams', async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(100));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readProviderBody(new Response(stream), 50, 'watch', 'provider'));
  assert.equal(cancelled, true);
});
