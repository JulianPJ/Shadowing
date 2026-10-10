import test from 'node:test';
import assert from 'node:assert/strict';
import { BANDS, DEFAULT_FILTERS, EMPTY_CONTEXT, type Band } from '../src/lib/discover/types';
import { buildFeed, rankVideos } from '../src/lib/discover/rank';
import { discoveryNow as now, discoveryVideo as video } from './helpers/discover';
import { evaluatePersonas } from './helpers/discover-evaluation';

const learner = (band: Band) => ({ ...EMPTY_CONTEXT, suggestedBand: band });
const index = (band: Band | null) => BANDS.findIndex((b) => b[0] === band);

test('For you blends comfortable, easier and stretch picks from verified matches', () => {
  const videos = Array.from({ length: 40 }, (_, i) =>
    video(i, {
      band: (['n5_n4', 'n4_n3', 'n3_n2', 'n4_n3'] as const)[i % 4],
      channelId: `channel-${i}`,
      topics: [(['everyday', 'food', 'travel', 'news'] as const)[i % 4]],
    }),
  );
  const ranked = rankVideos(videos, DEFAULT_FILTERS, learner('n4_n3'), now).slice(0, 10);
  const counts = { easier: 0, comfort: 0, stretch: 0 };
  for (const v of ranked) {
    const d = index(v.band) - index('n4_n3');
    counts[d < 0 ? 'easier' : d > 0 ? 'stretch' : 'comfort']++;
  }
  assert.deepEqual(counts, { comfort: 6, easier: 2, stretch: 2 });
  assert.match(ranked[0].reason, /close to your level/);
});
test('scarce verified levels are not padded with guesses', async () => {
  const videos = Array.from({ length: 12 }, (_, i) =>
    video(i, { levelTargets: ['beginner'], channelId: `channel-${i}` }),
  );
  const feed = await buildFeed(videos, DEFAULT_FILTERS, learner('n5_n4'), null, 'JP', now);
  assert.equal(feed.total, 12);
  // Unverified videos keep honest explanations; none claims an estimated level.
  for (const card of feed.items) {
    assert.equal(card.band, null);
    assert.doesNotMatch(card.reason, /Estimated|your level/);
  }
  assert.match(feed.items[0].reason, /search for beginner listening · level not yet estimated/);
  // Exact filters stay exact: a beginner search target is not a verified N5–N4 video.
  const exact = await buildFeed(
    videos,
    { ...DEFAULT_FILTERS, band: 'n5_n4' },
    learner('n5_n4'),
    null,
    'JP',
    now,
  );
  assert.equal(exact.total, 0);
  assert.deepEqual(exact.coverage, {
    total: 12,
    verified: 0,
    prepared: 0,
    byBand: Object.fromEntries(BANDS.map((b) => [b[0], 0])),
  });
});
test('much harder verified videos rank below relevant unverified content', () => {
  const ranked = rankVideos(
    [
      video(1, { band: 'n1_plus', prepared: true, channelId: 'a' }),
      video(2, { channelId: 'b', qualityScore: 80 }),
      video(3, { band: 'n5_n4', channelId: 'c' }),
    ],
    DEFAULT_FILTERS,
    learner('n5_n4'),
    now,
  );
  assert.deepEqual(
    ranked.map((v) => v.videoId),
    [video(3).videoId, video(2).videoId, video(1).videoId],
  );
});
test('preparation evidence leads and known caption problems stop leading', () => {
  const ranked = rankVideos(
    [
      video(1, { channelId: 'a', preparationStatus: 'needs-captions' }),
      video(2, { channelId: 'b' }),
      video(3, { channelId: 'c', prepared: true }),
    ],
    DEFAULT_FILTERS,
    EMPTY_CONTEXT,
    now,
  );
  assert.deepEqual(
    ranked.map((v) => v.videoId),
    [video(3).videoId, video(2).videoId, video(1).videoId],
  );
  assert.equal(ranked[0].reason, 'Japanese captions already prepared in Hibiki');
});
test('feeds are deterministic for shuffled catalogues and lanes never repeat a video', async () => {
  const videos = Array.from({ length: 30 }, (_, i) =>
    video(i, {
      band: i % 3 ? BANDS[i % 6][0] : null,
      prepared: i % 4 === 0,
      channelId: `channel-${i % 7}`,
    }),
  );
  const shuffled = [...videos].sort((a, b) =>
    (a.videoId.charCodeAt(10) * 7) % 11 < (b.videoId.charCodeAt(10) * 7) % 11 ? -1 : 1,
  );
  const first = await buildFeed(videos, DEFAULT_FILTERS, learner('n4_n3'), null, 'JP', now);
  const second = await buildFeed(shuffled, DEFAULT_FILTERS, learner('n4_n3'), null, 'JP', now);
  assert.deepEqual(
    first.items.map((v) => v.videoId),
    second.items.map((v) => v.videoId),
  );
  const laneIds = first.lanes.flatMap((l) => l.items.map((v) => v.videoId));
  assert.equal(new Set(laneIds).size, laneIds.length);
  assert.ok(first.lanes.some((l) => l.key === 'ready'));
});
test('evaluation: no persona sees much harder verified videos in its top ten', async () => {
  for (const row of await evaluatePersonas()) {
    assert.equal(row.tooHard, 0, row.persona);
    assert.ok(row.withinOneBand >= 5, row.persona);
    assert.ok(row.p10 >= 0.8, row.persona);
    assert.ok(row.channelsInTop10 >= 8, row.persona);
  }
});
