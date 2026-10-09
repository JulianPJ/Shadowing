import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '../src/lib/d1';
import { readCatalog, saveVideos } from '../src/lib/discover/catalog';
import {
  DISCOVER_DAILY_BUDGET,
  refreshCatalog,
  verifyAnalyses,
  youtubeQuotaWindow,
} from '../src/lib/discover/refresh';
import { handleFeedRequest } from '../src/lib/discover/server';
import { handleDiscoverAccountRequest } from '../src/lib/discover/account-server';
import { readWatchLater, writeWatchLater, type WatchRecord } from '../src/lib/discover/watch-later';
import { discoveryVideo, youtubeMetadata } from './helpers/discover';
import {
  createD1LinkedTranscriptRepository,
  storedMediaIdentity,
  transcriptHash,
} from '../src/lib/linked-transcripts';
import {
  createD1GeneratedArtifactRepository,
  DIFFICULTY_GENERATOR_VERSION,
} from '../src/lib/generated-artifacts';
import { createDifficultyAnalysis } from '../src/lib/difficulty';
import { segmentTranscript } from '../src/lib/segmentation';
import { transcriptKey } from '../src/lib/transcript';
import { resolveMediaUrl } from '../src/lib/media';
import { DEFAULT_FILTERS, EMPTY_CONTEXT } from '../src/lib/discover/types';
import { accountHandler } from '../src/lib/sync/server';
import { createAuth } from '../src/lib/auth/server';
import { createD1UserProgressRepository } from '../src/lib/sync/repository';

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("test")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'discover-test' },
  }),
);
let db: D1Database;
before(async () => {
  db = await mf.getD1Database('HIBIKI_DB');
  for (const name of (await readdir('migrations')).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort())
    await db.batch(
      (await readFile(`migrations/${name}`, 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  for (const id of ['one', 'two'])
    await db
      .prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(id, id, `${id}@test.example`, Date.now(), Date.now())
      .run();
});
after(() => mf.dispose());
beforeEach(async () => {
  for (const table of [
    'discovery_video_state',
    'discovery_videos',
    'discovery_feedback',
    'discovery_metric_events',
    'discovery_aggregate_metrics',
    'discovery_jobs',
    'discovery_quota',
    'user_watch_later',
    'user_discovery_preferences',
    'user_practice_sessions',
    'linked_transcripts',
    'generated_artifacts',
  ])
    await db.prepare(`DELETE FROM ${table}`).run();
  await db
    .prepare('UPDATE discovery_seed_queries SET enabled=1,last_run_at=NULL,next_run_at=?')
    .bind(new Date(0).toISOString())
    .run();
});
const now = () => Date.now();
const video = (i = 0) =>
  discoveryVideo(i, {
    fetchedAt: new Date().toISOString(),
    indexedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  });
const request = (path: string, method = 'GET', body?: unknown) =>
  new Request(`https://hibiki.example${path}`, {
    method,
    headers: { Origin: 'https://hibiki.example', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
const record = (i = 0, changes: Partial<WatchRecord> = {}): WatchRecord => ({
  videoId: video(i).videoId,
  title: `Video ${i}`,
  position: i,
  addedAt: new Date(Date.now() - 60000).toISOString(),
  updatedAt: new Date(Date.now() - 30000).toISOString(),
  removed: false,
  ...changes,
});

test('real D1 catalogue upserts deduplicate and preserve topics/indexed date across refresh', async () => {
  const first = video();
  await saveVideos(db, [first]);
  await saveVideos(db, [
    {
      ...first,
      title: 'Refreshed',
      topics: ['travel'],
      indexedAt: new Date(Date.now() + 60000).toISOString(),
    },
  ]);
  const rows = await readCatalog(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'Refreshed');
  assert.equal(rows[0].indexedAt, first.indexedAt);
  assert.deepEqual(new Set(rows[0].topics), new Set(['everyday', 'travel']));
  assert.equal(rows[0].band, null);
});
test('feed reads only catalogue metadata, excludes expired and never fetches providers', async () => {
  await saveVideos(db, [video(0), { ...video(1), expiresAt: new Date(0).toISOString() }]);
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('No network allowed while browsing');
  };
  try {
    const response = await handleFeedRequest(request('/api/discover'), db);
    assert.equal(response.status, 200);
    const feed = await response.json();
    assert.equal(feed.items.length, 1);
    assert.equal(feed.items[0].band, null);
    assert.ok(!JSON.stringify(feed).includes('segments'));
  } finally {
    globalThis.fetch = previous;
  }
});
test('personalised requests are no-store; malformed filters/origins/cursors are rejected', async () => {
  await saveVideos(db, [video()]);
  const response = await handleFeedRequest(
    request('/api/discover', 'POST', { filters: DEFAULT_FILTERS, context: EMPTY_CONTEXT }),
    db,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(
    (
      await handleFeedRequest(
        new Request('https://hibiki.example/api/discover', {
          method: 'POST',
          headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
          body: '{}',
        }),
        db,
      )
    ).status,
    403,
  );
  assert.equal((await handleFeedRequest(request('/api/discover?band=bad'), db)).status, 400);
  assert.equal((await handleFeedRequest(request('/api/discover?cursor=garbage'), db)).status, 400);
});
test('catalogue levels require exact independently validated public transcript artifacts', async () => {
  await saveVideos(db, [video()]);
  const media = (await resolveMediaUrl(video().canonicalUrl)).media;
  const cues = Array.from({ length: 6 }, (_, i) => ({
    start: i * 8,
    end: i * 8 + 7,
    text: `今日は日本語の勉強について話します。毎日練習すると少しずつ上手になります。${i}。`,
  }));
  const hash = await transcriptHash(cues),
    time = new Date().toISOString();
  await createD1LinkedTranscriptRepository(db).save({
    schemaVersion: 1,
    contentKey: 'youtube:video000000',
    media: storedMediaIdentity(media),
    language: 'ja',
    transcriptHash: hash,
    cues,
    source: {
      schemaVersion: 1,
      type: 'provider-captions',
      language: 'ja',
      provenance: 'test',
      provider: 'test',
      transcriptHash: hash,
      normalizationVersion: 1,
      segmentationVersion: 1,
    },
    visibility: 'system',
    createdAt: time,
  });
  const lesson = { id: 'youtube-video000000', segments: segmentTranscript(cues) },
    key = await transcriptKey(lesson);
  const difficulty = await createDifficultyAnalysis(
    {
      overall: 'n4_n3',
      vocabulary: 'intermediate',
      grammar: 'elementary',
      conversation: 'intermediate',
      confidence: { overall: 0.5, vocabulary: 0.5, grammar: 0.5, conversation: 0.5 },
    },
    lesson,
  );
  await createD1GeneratedArtifactRepository(db).save(
    {
      contentKey: 'youtube:video000000',
      transcriptKey: key,
      sourceTranscriptHash: hash,
      artifactType: 'difficulty',
      schemaVersion: 1,
      generatorVersion: DIFFICULTY_GENERATOR_VERSION,
      payload: difficulty,
      payloadId: difficulty.id,
      createdAt: difficulty.generatedAt,
    },
    lesson,
  );
  await verifyAnalyses(db);
  let card = (await readCatalog(db))[0];
  assert.equal(card.band, 'n4_n3');
  assert.equal(card.proof?.transcriptKey, key);
  assert.equal(card.prepared, true);
  await db.prepare("UPDATE linked_transcripts SET visibility='private',owner_user_id='one'").run();
  card = (await readCatalog(db))[0];
  assert.equal(card.band, null);
  assert.equal(card.proof, null);
  assert.equal(card.prepared, false);
});
test('scheduled refresh budgets and batches official API calls, releases lease and respects cooldown', async () => {
  let searches = 0,
    metadata = 0;
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/search')) {
      searches++;
      return Response.json({ items: [{ id: { videoId: 'video000000' } }] });
    }
    metadata++;
    return Response.json({ items: [youtubeMetadata('video000000')] });
  };
  const time = Date.parse(`${youtubeQuotaWindow(now()).day}T20:00:00Z`);
  await refreshCatalog(db, 'key', fetchImpl, time);
  assert.equal(searches, 2);
  assert.equal(metadata, 2);
  assert.equal((await readCatalog(db)).length, 1);
  assert.equal((await db.prepare('SELECT * FROM discovery_jobs').all()).results.length, 0);
  await db.prepare('UPDATE discovery_seed_queries SET enabled=0 WHERE last_run_at IS NULL').run();
  await refreshCatalog(db, 'key', fetchImpl, time);
  assert.equal(searches, 2);
  assert.equal(metadata, 2);
  assert.equal(
    (await db.prepare('SELECT units FROM discovery_quota').first<{ units: number }>())?.units,
    202,
  );
  // Existing deployments may still have yesterday's 24-hour seed schedule.
  await db
    .prepare('UPDATE discovery_seed_queries SET next_run_at=?')
    .bind(new Date(time + 86400000).toISOString())
    .run();
  await refreshCatalog(db, 'key', fetchImpl, time + 3600000);
  assert.equal(searches, 4);
  assert.equal(metadata, 4);
});
test('YouTube quota days follow Pacific midnight in summer, winter and DST transitions', () => {
  for (const [instant, day] of [
    ['2026-07-01T06:59:59Z', '2026-06-30'],
    ['2026-07-01T07:00:00Z', '2026-07-01'],
    ['2026-01-01T07:59:59Z', '2025-12-31'],
    ['2026-01-01T08:00:00Z', '2026-01-01'],
    ['2026-03-08T09:59:59Z', '2026-03-08'],
    ['2026-03-08T10:00:00Z', '2026-03-08'],
    ['2026-11-01T08:59:59Z', '2026-11-01'],
    ['2026-11-01T09:00:00Z', '2026-11-01'],
  ])
    assert.equal(youtubeQuotaWindow(Date.parse(instant)).day, day);
});
test('a full refresh day uses nearly 9000 points with paced searches and varied result ordering', async () => {
  let searches = 0;
  const orders = new Set<string>();
  const queries = new Set<string>();
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/search')) {
      searches++;
      orders.add(url.searchParams.get('order')!);
      queries.add(url.searchParams.get('q')!);
      return Response.json({ items: [{ id: { videoId: 'video000000' } }] });
    }
    return Response.json({ items: [youtubeMetadata('video000000')] });
  };
  const start = Date.parse('2026-07-01T07:00:00Z');
  for (let slot = 0; slot < 96; slot++) {
    await refreshCatalog(db, 'key', fetchImpl, start + slot * 15 * 60000);
    if (slot === 0) assert.equal(searches, 0);
    if (slot === 47) assert.ok(searches >= 40 && searches <= 44);
  }
  const quota = await db.prepare('SELECT day,units FROM discovery_quota').first<{
    day: string;
    units: number;
  }>();
  assert.equal(quota?.day, '2026-07-01');
  assert.ok(quota!.units >= 8800 && quota!.units <= DISCOVER_DAILY_BUDGET);
  assert.ok(searches >= 87 && searches <= 89);
  assert.equal(queries.size, 9);
  assert.deepEqual([...orders].sort(), ['date', 'relevance', 'viewCount']);
});
test('exhausted quota blocks network calls and resets only at Pacific midnight', async () => {
  const start = Date.parse('2026-07-01T07:00:00Z');
  await db
    .prepare('INSERT INTO discovery_quota(day,units) VALUES(?,?)')
    .bind('2026-07-01', DISCOVER_DAILY_BUDGET)
    .run();
  let requests = 0;
  const fetchImpl: typeof fetch = async () => {
    requests++;
    return Response.json({ items: [] });
  };
  await refreshCatalog(db, 'key', fetchImpl, start + 18 * 3600000); // UTC date already changed.
  assert.equal(requests, 0);
  await refreshCatalog(db, 'key', fetchImpl, start + 86400000 + 15 * 60000);
  assert.equal(requests, 1);
  assert.equal(
    (
      await db
        .prepare('SELECT units FROM discovery_quota WHERE day=?')
        .bind('2026-07-02')
        .first<{ units: number }>()
    )?.units,
    100,
  );
});
test('searches reserve metadata headroom while stale metadata can use the last point', async () => {
  const time = Date.parse(`${youtubeQuotaWindow(now()).day}T20:00:00Z`);
  await db
    .prepare('INSERT INTO discovery_quota(day,units) VALUES(?,?)')
    .bind(youtubeQuotaWindow(time).day, DISCOVER_DAILY_BUDGET - 1)
    .run();
  await saveVideos(db, [{ ...video(), fetchedAt: new Date(time - 2 * 86400000).toISOString() }]);
  let searches = 0;
  let metadata = 0;
  await refreshCatalog(
    db,
    'key',
    async (input) => {
      if (new URL(String(input)).pathname.endsWith('/search')) searches++;
      else metadata++;
      return Response.json({ items: [youtubeMetadata('video000000')] });
    },
    time,
  );
  assert.equal(searches, 0);
  assert.equal(metadata, 1);
  assert.equal(
    (await db.prepare('SELECT units FROM discovery_quota').first<{ units: number }>())?.units,
    DISCOVER_DAILY_BUDGET,
  );
});
test('quota failure never extends stale metadata and expiry purge works without key', async () => {
  const expired = { ...video(), expiresAt: new Date(Date.now() - 1000).toISOString() };
  await saveVideos(db, [expired]);
  await refreshCatalog(db, undefined, async () => {
    throw new Error('No key must not fetch');
  });
  assert.equal((await db.prepare('SELECT * FROM discovery_videos').all()).results.length, 0);
  await refreshCatalog(db, 'key', async () => new Response(null, { status: 429 }));
  assert.equal((await db.prepare('SELECT * FROM discovery_jobs').all()).results.length, 0);
});
test('account queue is idempotent, canonical, scoped and does not fetch subtitles', async () => {
  const previous = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('Saving must not fetch');
  };
  try {
    assert.equal(
      (
        await handleDiscoverAccountRequest(
          request('/api/watch-later', 'POST', { videoId: 'video000000', title: 'Morning' }),
          'one',
          true,
          db,
        )
      ).status,
      200,
    );
    await handleDiscoverAccountRequest(
      request('/api/watch-later', 'POST', { videoId: 'video000000', title: 'Morning' }),
      'one',
      true,
      db,
    );
    assert.equal((await readWatchLater(db, 'one')).filter((r) => !r.removed).length, 1);
    assert.equal((await readWatchLater(db, 'two')).length, 0);
    assert.equal(
      (
        await db
          .prepare('SELECT canonical_url FROM user_watch_later')
          .first<{ canonical_url: string }>()
      )?.canonical_url,
      video().canonicalUrl,
    );
    assert.equal((await db.prepare('SELECT * FROM linked_transcripts').all()).results.length, 0);
  } finally {
    globalThis.fetch = previous;
  }
});
test('removals and cross-device reorders merge without stale-device resurrection', async () => {
  const old = record();
  await writeWatchLater(db, 'one', [old]);
  const removed = { ...old, updatedAt: new Date(Date.now() - 1000).toISOString(), removed: true };
  await writeWatchLater(db, 'one', [removed]);
  await writeWatchLater(db, 'one', [old]);
  assert.equal((await readWatchLater(db, 'one'))[0].removed, true);
  await writeWatchLater(db, 'one', [record(1), record(2)]);
  const newer = new Date().toISOString();
  await writeWatchLater(db, 'one', [record(2, { position: -1, updatedAt: newer })]);
  assert.equal((await readWatchLater(db, 'one'))[0].videoId, 'video000002');
});
test('real D1 capacity guard is transactional across batches and can recover after removal', async () => {
  await writeWatchLater(
    db,
    'one',
    Array.from({ length: 40 }, (_, i) => record(i)),
  );
  await assert.rejects(() => writeWatchLater(db, 'one', [record(40)]), /40 links/);
  assert.equal((await readWatchLater(db, 'one')).filter((r) => !r.removed).length, 40);
  await writeWatchLater(db, 'one', [
    record(0, { removed: true, updatedAt: new Date().toISOString() }),
  ]);
  await writeWatchLater(db, 'one', [record(40)]);
  assert.equal((await readWatchLater(db, 'one')).filter((r) => !r.removed).length, 40);
});
test('a full remote queue accepts replacement saves before removal records in the same batch', async () => {
  await writeWatchLater(
    db,
    'one',
    Array.from({ length: 40 }, (_, i) => record(i)),
  );
  const updatedAt = new Date().toISOString();
  await writeWatchLater(db, 'one', [
    ...Array.from({ length: 40 }, (_, i) => record(i + 40, { updatedAt })),
    ...Array.from({ length: 40 }, (_, i) => record(i, { removed: true, updatedAt })),
  ]);
  const active = (await readWatchLater(db, 'one')).filter((r) => !r.removed);
  assert.equal(active.length, 40);
  assert.ok(active.every((r) => Number(r.videoId.slice(-6)) >= 40));
});
test('account mutation rejects unverified users, bad origins and future timestamps', async () => {
  assert.equal(
    (
      await handleDiscoverAccountRequest(
        request('/api/watch-later', 'POST', { records: [record()] }),
        'one',
        false,
        db,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleDiscoverAccountRequest(
        new Request('https://hibiki.example/api/discover/preferences', {
          method: 'PATCH',
          headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
          body: '{}',
        }),
        'one',
        true,
        db,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handleDiscoverAccountRequest(
        request('/api/watch-later', 'POST', {
          records: [record(0, { updatedAt: '2099-01-01T00:00:00.000Z' })],
        }),
        'one',
        true,
        db,
      )
    ).status,
    400,
  );
});
test('actual auth routing cannot read another account by supplying a stale owner header', async () => {
  const env = {
    AUTH_BASE_URL: 'https://hibiki.example',
    AUTH_SECRET: 'a-deterministic-test-secret-at-least-32-characters',
  };
  const auth = createAuth(db, env);
  const sessionToken = 'deterministic-discover-session';
  await db
    .prepare(
      'INSERT INTO session(id,userId,token,expiresAt,createdAt,updatedAt) VALUES(?,?,?,?,?,?)',
    )
    .bind('discover-session', 'one', sessionToken, Date.now() + 86400000, Date.now(), Date.now())
    .run();
  // Direct test cookie uses the framework signature, matching production session lookup.
  const signature = createHmac('sha256', env.AUTH_SECRET).update(sessionToken).digest('base64');
  const cookie = `__Secure-better-auth.session_token=${encodeURIComponent(`${sessionToken}.${signature}`)}`;
  const handler = accountHandler(auth, createD1UserProgressRepository(db), env, db);
  const response = await handler(
    new Request('https://hibiki.example/api/watch-later', {
      headers: { Cookie: cookie, 'X-Hibiki-Account': 'two' },
    }),
  );
  assert.equal(response.status, 409);
});
test('completion metrics use the real practice day and reject expired or missing completion evidence', async () => {
  await saveVideos(db, [video(0), video(1), video(2)]);
  const recent = new Date(Date.now() - 5 * 86400000).toISOString();
  const expired = new Date(Date.now() - 60 * 86400000).toISOString();
  for (const [id, completedAt] of [
    [0, recent],
    [1, expired],
  ] as const) {
    await db
      .prepare(
        'INSERT INTO user_practice_sessions(user_id,id,lesson_id,transcript_key,payload_json,updated_at) VALUES(?,?,?,?,?,?)',
      )
      .bind(
        'one',
        `completion-${id}`,
        `youtube-video${String(id).padStart(6, '0')}`,
        'fixture-key',
        JSON.stringify({ completed: true, completedAt }),
        completedAt,
      )
      .run();
  }
  const events = [0, 1, 2].map((i) => ({
    videoId: `video${String(i).padStart(6, '0')}`,
    action: 'complete',
  }));
  for (let retry = 0; retry < 2; retry++) {
    const response = await handleDiscoverAccountRequest(
      request('/api/discover/events', 'POST', { events }),
      'one',
      true,
      db,
    );
    assert.equal(response.status, 200);
  }
  const rows = (await db.prepare('SELECT day,video_id FROM discovery_metric_events').all()).results;
  assert.deepEqual(rows, [{ day: recent.slice(0, 10), video_id: 'video000000' }]);
});
test('popularity remains private below ten learners and raw events expire', async () => {
  await saveVideos(db, [video()]);
  const day = new Date().toISOString().slice(0, 10);
  await handleDiscoverAccountRequest(
    request('/api/discover/events', 'POST', {
      events: [
        { videoId: 'video000000', action: 'open' },
        { videoId: 'video000000', action: 'open' },
      ],
    }),
    'one',
    true,
    db,
  );
  assert.equal((await db.prepare('SELECT * FROM discovery_metric_events').all()).results.length, 1);
  await refreshCatalog(db);
  assert.equal(
    (await db.prepare('SELECT * FROM discovery_aggregate_metrics').all()).results.length,
    0,
  );
  for (let i = 0; i < 9; i++) {
    const id = `cohort-${i}`;
    await db
      .prepare(
        'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES(?,?,?,1,?,?)',
      )
      .bind(id, id, `${id}@test.example`, Date.now(), Date.now())
      .run();
    await db
      .prepare('INSERT INTO discovery_metric_events(user_id,day,video_id,action) VALUES(?,?,?,?)')
      .bind(id, day, 'video000000', 'open')
      .run();
  }
  await refreshCatalog(db);
  const popularity = (await readCatalog(db))[0].popularity;
  assert.equal(popularity, 10);
  await db
    .prepare(
      "INSERT INTO discovery_metric_events(user_id,day,video_id,action) VALUES('one','2020-01-01','video000000','open')",
    )
    .run();
  await refreshCatalog(db);
  assert.equal(
    (await db.prepare("SELECT * FROM discovery_metric_events WHERE day='2020-01-01'").all()).results
      .length,
    0,
  );
});
