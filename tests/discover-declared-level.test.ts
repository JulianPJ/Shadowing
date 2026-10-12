import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bandForLevels,
  declaredBand,
  namedLevels,
  withChannelLevels,
} from '../src/lib/discover/declared-level';
import { buildFeed } from '../src/lib/discover/rank';
import { ANALYSIS_CRON, CATALOGUE_CRON } from '../src/lib/discover/schedule';
import { DEFAULT_FILTERS, EMPTY_CONTEXT } from '../src/lib/discover/types';
import { discoveryNow as now, discoveryVideo as video } from './helpers/discover';

// Titles from the production catalogue (October 2026).
const titles: [string, ReturnType<typeof declaredBand>][] = [
  ['【N5-N4】Cheap eat out in Japan - Japanese listening exercise', 'n5_n4'],
  [
    'ずっと悩んでたこと「普通って何？」 Japanese Listening Practice N3・N2レベル【中級】Ep.703',
    'n3_n2',
  ],
  ['Slow Japanese Conversation | Listening Practice |  The Old Man’s Restaurant (N4~N5)', 'n5_n4'],
  [
    '5-Minute Easy Japanese Listening Practice: The Evolution of Japanese Food 日本料理の魅力 (N2-3)',
    'n3_n2',
  ],
  ['REAL Japanese at Airport Security 🇯🇵 | Advanced Japanese Listening Practice (N2–N1)', 'n2_n1'],
  [
    '【JLPT N5】ゆっくり日本語会話「レストランの予約」/ Slow Japanese Podcast for Beginners',
    'n5_plus',
  ],
  [
    'Casual Conversation for Beginners | N4 Japanese Listening Practice (Comprehensible Input)',
    'n5_n4',
  ],
  ['Talking While Playing Cooking Simulator | N3 Japanese Listening Practice', 'n4_n3'],
  [
    '5-Minute Easy Japanese Listening Practice: The Essence of Japanese Cuisine 日本料理の真髄 (N1)',
    'n2_n1',
  ],
  ['I’m Leaving Japan… 🇯🇵✈️ Easy Japanese Vlog (N5/N4 Listening)', 'n5_n4'],
  ['Can you understand my Japanese? / N5 & N4 Japanese Listening Practice! #132', 'n5_n4'],
  ['🎧【N4・N3向け】ゆっくり聞ける日本語Podcast｜日本文化・日常生活リスニング', 'n4_n3'],
  [
    '日常会話 実生活ダイアログ｜20 Daily Japanese Conversations N5–N3｜Real-Life Dialogues',
    'n4_n3',
  ],
  ['【ＪＬＰＴ Ｎ３】全角のタイトル', 'n4_n3'],
  // Too wide to place this video, and no other evidence is consulted.
  ['From N5 to N1: my study story 初級', null],
  // Not JLPT levels.
  ['Nintendo N64 and 3DS memories', null],
  ['日本語VLOG', null],
];

test('creator levels in titles map to the band ending at the hardest stated level', () => {
  for (const [title, band] of titles) assert.equal(declaredBand(title, '', false), band, title);
});

test('levels and spans map consistently onto bands', () => {
  assert.deepEqual(namedLevels('N2-3').sort(), [2, 3]);
  assert.deepEqual(namedLevels('n12 N64 AN5'), []);
  assert.equal(bandForLevels([5]), 'n5_plus');
  assert.equal(bandForLevels([4]), 'n5_n4');
  assert.equal(bandForLevels([1]), 'n2_n1');
  assert.equal(bandForLevels([5, 3]), 'n4_n3');
  assert.equal(bandForLevels([5, 2]), null);
});

test('level words and descriptions count only for learner-oriented videos', () => {
  const genki = '初級日本語げんき 会話ビデオ GENKI Dialogue Videos Lesson 1';
  assert.equal(declaredBand(genki, '', true), 'n5_n4');
  assert.equal(declaredBand(genki, '', false), null);
  // An unrelated native title using 入門 is not a level.
  assert.equal(declaredBand('注目AIニュース Security 入門・Claude 日本語推敲', '', false), null);
  assert.equal(declaredBand('Comprehensible Japanese 【Beginner】', '', true), 'n5_n4');
  assert.equal(declaredBand('Upper-intermediate Japanese podcast', '', true), 'n2_n1');
  assert.equal(declaredBand('Japanese for beginner to advanced learners', '', true), null);
  // Descriptions: narrow ranges only, since channels advertise every course they sell.
  assert.equal(declaredBand('日本の昔の暮らし #57', 'N3・N2向けのポッドキャスト', true), 'n3_n2');
  assert.equal(
    declaredBand('【Vlog.04】京都に行きました。', 'N3-N1 courses available', true),
    null,
  );
  assert.equal(declaredBand('日本の昔の暮らし #57', 'N3・N2向け', false), null);
});

test('unplaced videos inherit a channel level only with agreement', () => {
  const placed = withChannelLevels([
    video(1, { channelId: 'teacher', band: 'n3_n2', levelSource: 'creator' }),
    video(2, { channelId: 'teacher', band: 'n3_n2' }),
    video(3, { channelId: 'teacher' }),
    video(4, { channelId: 'mixed', band: 'n5_n4', levelSource: 'creator' }),
    video(5, { channelId: 'mixed', band: 'n2_n1', levelSource: 'creator' }),
    video(6, { channelId: 'mixed' }),
    video(7, { channelId: 'single', band: 'n5_n4', levelSource: 'creator' }),
    video(8, { channelId: 'single' }),
  ]);
  assert.deepEqual([placed[2].band, placed[2].levelSource], ['n3_n2', 'channel']);
  assert.equal(placed[5].band, null);
  assert.equal(placed[7].band, null);
});

test('creator-labelled videos fill level filters and are named as labels, not estimates', async () => {
  const videos = [
    video(1, { band: 'n5_n4', levelSource: 'creator', channelId: 'a' }),
    video(2, { band: 'n5_n4', channelId: 'b' }),
    video(3, { band: 'n5_n4', levelSource: 'channel', channelId: 'c' }),
    video(4, { channelId: 'd' }),
  ];
  const learner = { ...EMPTY_CONTEXT, suggestedBand: 'n5_n4' as const };
  const exact = await buildFeed(
    videos,
    { ...DEFAULT_FILTERS, band: 'n5_n4' },
    learner,
    null,
    'JP',
    now,
  );
  assert.equal(exact.total, 3);
  assert.equal(exact.coverage?.verified, 1);
  assert.equal(exact.coverage?.placed, 3);
  const reasons = Object.fromEntries(exact.items.map((v) => [v.videoId, v.reason]));
  assert.match(reasons[videos[0].videoId], /^Labelled N5–N4 by the creator, close to your level/);
  assert.match(reasons[videos[1].videoId], /^Estimated N5–N4, close to your level/);
  assert.match(reasons[videos[2].videoId], /^Usually N5–N4 on this channel/);
  // An analysed transcript outranks an equal creator label, which outranks a channel inference.
  assert.deepEqual(
    exact.items.map((v) => v.videoId),
    [videos[1].videoId, videos[0].videoId, videos[2].videoId],
  );
});

test('the Worker configuration schedules both scheduled jobs', async () => {
  const config = await readFile('cloudflare.config.ts', 'utf8');
  for (const schedule of [CATALOGUE_CRON, ANALYSIS_CRON])
    assert.ok(config.includes(`schedule: '${schedule}'`), schedule);
});
