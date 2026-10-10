import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, DEFAULT_FILTERS, EMPTY_CONTEXT, type Context } from '../src/lib/discover/types';
import {
  normalizeFilters,
  validateContext,
  validatePreferences,
} from '../src/lib/discover/validation';
import { durationMatches, eligible } from '../src/lib/discover/eligibility';
import { buildFeed, rankVideos } from '../src/lib/discover/rank';
import {
  parseDuration,
  thumbnailUrl,
  youtubeDataApi,
  youtubeFetchFailureDetails,
  YoutubeDataError,
} from '../src/lib/discover/youtube-data-api';
import {
  mergeWatchRecords,
  queueFromRecords,
  validateWatchRecord,
  type WatchRecord,
} from '../src/lib/discover/watch-later';
import { discoveryNow as now, discoveryVideo as video, youtubeMetadata } from './helpers/discover';
import { prepareLinkedVideo } from '../src/lib/prepare-client';

test('six exact bands remain compatible; unknown levels only enter For you/All', () => {
  assert.equal(BANDS.length, 6);
  for (const [band] of BANDS) {
    assert.equal(eligible(video(), { ...DEFAULT_FILTERS, band }, 'JP', now), false);
    assert.equal(eligible(video(0, { band }), { ...DEFAULT_FILTERS, band }, 'JP', now), true);
  }
  assert.equal(eligible(video(), DEFAULT_FILTERS, 'JP', now), true);
  assert.equal(eligible(video(), { ...DEFAULT_FILTERS, band: 'all' }, 'JP', now), true);
});
test('query normalization rejects unbounded queries and unrecognized filters', () => {
  assert.equal(normalizeFilters({ q: '  日本語　会話  ' }).q, '日本語 会話');
  for (const input of [
    { band: 'N4' },
    { q: 'x'.repeat(121) },
    { speed: 'supersonic' },
    { topic: 'sql' },
    { sort: 'youtube-views' },
  ])
    assert.throws(() => normalizeFilters(input), /Invalid/);
  assert.throws(() => validateContext({ saved: Array(41).fill('video000000') }), /Invalid/);
  assert.throws(() => validateContext({ vocabularyFit: { video000000: Infinity } }), /Invalid/);
  assert.throws(() => validatePreferences({ topics: ['not-a-topic'] }), /Invalid/);
});
test('duration boundaries, topic, speed, captions, orientation and regional eligibility are independent', () => {
  assert.equal(durationMatches(300, 'under5'), false);
  assert.equal(durationMatches(300, '5to10'), true);
  assert.equal(durationMatches(600, '5to10'), true);
  assert.equal(durationMatches(600, '10to20'), false);
  assert.equal(durationMatches(1200, '10to20'), true);
  for (const changes of [
    { status: 'unavailable' as const },
    { embeddable: false },
    { expiresAt: '2026-10-01T00:00:00Z' },
    { regionBlocked: ['GB'] },
    { regionAllowed: ['JP'] },
  ])
    assert.equal(eligible(video(0, changes), DEFAULT_FILTERS, 'GB', now), false);
  assert.equal(eligible(video(), { ...DEFAULT_FILTERS, speed: 'slow' }, 'JP', now), false);
  assert.equal(
    eligible(video(0, { speed: 2 }), { ...DEFAULT_FILTERS, speed: 'slow' }, 'JP', now),
    true,
  );
  assert.equal(eligible(video(), { ...DEFAULT_FILTERS, captions: 'prepared' }, 'JP', now), false);
  assert.equal(eligible(video(), { ...DEFAULT_FILTERS, captions: 'reported' }, 'JP', now), true);
  assert.equal(eligible(video(), { ...DEFAULT_FILTERS, audience: 'learner' }, 'JP', now), false);
});
test('ranking is deterministic, explainable and respects explicit feedback', () => {
  const videos = [
    video(1, { band: 'n4_n3' }),
    video(2, { band: 'n1_plus' }),
    video(3, { topics: ['travel'] }),
    video(4),
  ];
  const context: Context = {
    ...EMPTY_CONTEXT,
    suggestedBand: 'n4_n3',
    preferredTopics: ['travel'],
    ignored: [videos[3].videoId],
  };
  const first = rankVideos(videos, DEFAULT_FILTERS, context, now);
  assert.deepEqual(first, rankVideos([...videos].reverse(), DEFAULT_FILTERS, context, now));
  assert.equal(first.length, 3);
  assert.equal(first[0].videoId, videos[0].videoId);
  assert.match(first[0].reason, /close to your level/);
  assert.match(first.find((v) => v.videoId === videos[2].videoId)!.reason, /travel/);
});
test('diversity interleaves dominant channels without dropping results', () => {
  const videos = Array.from({ length: 15 }, (_, i) =>
    video(i, {
      channelId: i < 10 ? 'dominant' : `other-${i}`,
      topics: i < 10 ? ['everyday'] : ['travel'],
    }),
  );
  const ranked = rankVideos(videos, { ...DEFAULT_FILTERS, diversity: 'wide' }, EMPTY_CONTEXT, now);
  assert.equal(new Set(ranked.map((v) => v.videoId)).size, 15);
  assert.ok(new Set(ranked.slice(0, 5).map((v) => v.channelId)).size > 1);
});
test('server pagination has no duplicates and invalidates changed query/context or catalogue', async () => {
  const videos = Array.from({ length: 65 }, (_, i) => video(i));
  const filters = { ...DEFAULT_FILTERS, band: 'all' as const };
  const first = await buildFeed(videos, filters, EMPTY_CONTEXT, null, 'JP', now);
  assert.equal(first.items.length, 24);
  assert.ok(first.hasMore);
  const second = await buildFeed(videos, filters, EMPTY_CONTEXT, first.nextCursor, 'JP', now);
  const third = await buildFeed(videos, filters, EMPTY_CONTEXT, second.nextCursor, 'JP', now);
  assert.equal(
    new Set([...first.items, ...second.items, ...third.items].map((v) => v.videoId)).size,
    65,
  );
  assert.equal(third.hasMore, false);
  await assert.rejects(
    () => buildFeed(videos, { ...filters, q: 'other' }, EMPTY_CONTEXT, first.nextCursor, 'JP', now),
    /cursor/,
  );
  await assert.rejects(
    () =>
      buildFeed(
        videos,
        filters,
        { ...EMPTY_CONTEXT, ignored: [videos[0].videoId] },
        first.nextCursor,
        'JP',
        now,
      ),
    /cursor/,
  );
  await assert.rejects(
    () => buildFeed(videos, filters, EMPTY_CONTEXT, 'broken', 'JP', now),
    /cursor/,
  );
});
test('lanes deduplicate saves, completions, seen and other lanes; trending abstains below cohort', async () => {
  const videos = Array.from({ length: 35 }, (_, i) =>
    video(i, { band: i % 2 ? 'n4_n3' : 'n3_n2' }),
  );
  const context = {
    ...EMPTY_CONTEXT,
    suggestedBand: 'n4_n3' as const,
    saved: [videos[0].videoId],
    completed: [videos[1].videoId],
    seen: [videos[2].videoId],
  };
  const feed = await buildFeed(videos, DEFAULT_FILTERS, context, null, 'JP', now);
  const ids = feed.lanes.flatMap((l) => l.items.map((v) => v.videoId));
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [...context.saved, ...context.completed, ...context.seen])
    assert.ok(!ids.includes(id));
  assert.ok(!feed.lanes.some((l) => l.key === 'trending'));
});
test('YouTube durations and thumbnail URLs are bounded and allowlisted', () => {
  assert.equal(parseDuration('PT1H2M3S'), 3723);
  for (const duration of ['PT0S', 'PT90H', 'garbage', null, 'P1D', 'PT-1M'])
    assert.equal(parseDuration(duration), null);
  for (const url of [
    'https://evil.test/x',
    'http://i.ytimg.com/x',
    'https://secret@i.ytimg.com/x',
    'data:image/svg+xml,x',
  ])
    assert.equal(thumbnailUrl(url), null);
});
test('official provider validates public/embed/live/age restrictions and never derives bands', async () => {
  const endpoints: string[] = [];
  let spent = 0;
  const provider = youtubeDataApi(
    'server-only',
    async (input, init) => {
      endpoints.push(String(input));
      assert.equal(new Headers(init?.headers).get('X-Goog-Api-Key'), 'server-only');
      assert.equal(init?.redirect, 'manual');
      return Response.json({
        items:
          endpoints.length === 1
            ? [{ id: { videoId: 'video000000' } }, { id: { videoId: 'bad' } }]
            : [
                youtubeMetadata('video000000'),
                youtubeMetadata('video000001', {
                  status: { embeddable: false, privacyStatus: 'public' },
                }),
              ],
      });
    },
    async (units) => {
      spent += units;
      return true;
    },
  );
  assert.deepEqual(await provider.search('日本語 会話'), ['video000000']);
  const result = await provider.videos(['video000000', 'video000001'], ['conversations'], now);
  assert.equal(result.length, 1);
  assert.equal(result[0].band, null);
  assert.equal(result[0].prepared, false);
  assert.deepEqual(result[0].topics, ['conversations']);
  assert.equal(spent, 101);
  assert.ok(endpoints.every((url) => new URL(url).origin === 'https://www.googleapis.com'));
  assert.equal(new URL(endpoints[0]).searchParams.get('part'), 'snippet');
  assert.equal(
    new URL(endpoints[1]).searchParams.get('part'),
    'snippet,contentDetails,status,topicDetails',
  );
  assert.ok(!endpoints.join('').includes('server-only'));
});
test('YouTube network diagnostics classify failures without exposing credentials', () => {
  const active = new AbortController().signal;
  const secret = 'SENSITIVE_API_KEY_DO_NOT_LOG';
  const network = youtubeFetchFailureDetails(new TypeError(secret), active);
  assert.deepEqual(network, { failureKind: 'network', errorType: 'TypeError' });
  const safeCause = new TypeError(secret, { cause: { code: 'ENOTFOUND', message: secret } });
  const networkCause = youtubeFetchFailureDetails(safeCause, active);
  assert.deepEqual(networkCause, {
    failureKind: 'network',
    errorType: 'TypeError',
    causeCode: 'ENOTFOUND',
  });
  assert.ok(!JSON.stringify(networkCause).includes(secret));
  const unsafeCause = new TypeError(secret, { cause: { code: secret } });
  assert.deepEqual(youtubeFetchFailureDetails(unsafeCause, active), network);
  const aborted = youtubeFetchFailureDetails(
    new DOMException(secret, 'AbortError'),
    AbortSignal.abort(),
  );
  assert.deepEqual(aborted, { failureKind: 'aborted', errorType: 'AbortError' });
  const timedOut = youtubeFetchFailureDetails(
    new TypeError(secret),
    AbortSignal.abort(new DOMException(secret, 'TimeoutError')),
  );
  assert.deepEqual(timedOut, { failureKind: 'timeout', errorType: 'TypeError' });
  const thrownTimeout = youtubeFetchFailureDetails(
    new DOMException(secret, 'TimeoutError'),
    active,
  );
  assert.deepEqual(thrownTimeout, { failureKind: 'timeout', errorType: 'TimeoutError' });
  assert.deepEqual(youtubeFetchFailureDetails(secret, active), {
    failureKind: 'network',
    errorType: 'UnknownError',
  });
});
test('quota/upstream/malformed response handling is bounded and never retries searches', async () => {
  let requests = 0;
  const quota = youtubeDataApi('key', async () => {
    requests++;
    return new Response(null, { status: 403 });
  });
  await assert.rejects(
    () => quota.search('日本語'),
    (error: unknown) => error instanceof YoutubeDataError && error.code === 'quota',
  );
  assert.equal(requests, 1);
  const redirected = youtubeDataApi('key', async (_input, init) => {
    assert.equal(init?.redirect, 'manual');
    return new Response(null, {
      status: 302,
      headers: { Location: 'https://example.invalid/redirect-target' },
    });
  });
  await assert.rejects(
    () => redirected.search('日本語'),
    (error: unknown) => error instanceof YoutubeDataError && error.code === 'unavailable',
  );
  const invalidRequest = youtubeDataApi('key', async () =>
    Response.json({ error: { errors: [{ reason: 'invalidPart' }] } }, { status: 400 }),
  );
  await assert.rejects(
    () => invalidRequest.search('日本語'),
    (error: unknown) => error instanceof YoutubeDataError && error.code === 'unavailable',
  );
  const budget = youtubeDataApi(
    'key',
    async () => {
      requests++;
      return Response.json({ items: [] });
    },
    async () => false,
  );
  await assert.rejects(() => budget.search('日本語'));
  assert.equal(requests, 1);
  await assert.rejects(() =>
    youtubeDataApi('key', async () => Response.json({ items: {} })).videos(['video000000']),
  );
  await assert.rejects(() => quota.videos(['https://evil.test']));
});
test('watch later merges deterministically with removal ties and no resurrection from older edits', () => {
  const base: WatchRecord = {
    videoId: 'video000000',
    title: 'Morning',
    position: 0,
    addedAt: '2026-10-08T09:00:00.000Z',
    updatedAt: '2026-10-08T09:00:00.000Z',
    removed: false,
  };
  const deleted = { ...base, updatedAt: '2026-10-08T10:00:00.000Z', removed: true };
  assert.deepEqual(mergeWatchRecords([base], [deleted]), mergeWatchRecords([deleted], [base]));
  assert.equal(queueFromRecords(mergeWatchRecords([deleted], [base])).length, 0);
  assert.equal(mergeWatchRecords([{ ...deleted, removed: false }], [deleted])[0].removed, true);
  assert.throws(
    () => validateWatchRecord({ ...base, updatedAt: '2099-01-01T00:00:00Z' }),
    /Invalid/,
  );
  assert.equal(
    queueFromRecords(
      Array.from({ length: 60 }, (_, i) => ({ ...base, videoId: video(i).videoId, position: i })),
    ).length,
    40,
  );
});
test('shared browser preparation handles final unterminated NDJSON and explicit caption continuation', async () => {
  const previous = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ code: 'no-japanese-captions', error: 'Add captions.' }));
    const result = await prepareLinkedVideo(
      'https://youtu.be/video000000',
      new AbortController().signal,
      () => {},
    );
    assert.equal(result.needsTranscript, 'Add captions.');
    assert.equal(result.resolved.media.type, 'youtube');
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ lesson: { id: 'youtube-video000000' } }));
    assert.equal(
      (
        await prepareLinkedVideo(
          'https://youtu.be/video000000',
          new AbortController().signal,
          () => {},
        )
      ).lesson?.id,
      'youtube-video000000',
    );
  } finally {
    globalThis.fetch = previous;
  }
});
