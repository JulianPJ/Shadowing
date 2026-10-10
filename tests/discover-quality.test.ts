import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assessQuality, QUALITY_THRESHOLD, type QualityInput } from '../src/lib/discover/quality';
import {
  LEVEL_TARGETS,
  categoryTopic,
  chooseSeeds,
  seedCooldown,
  seedOrder,
  type Seed,
} from '../src/lib/discover/acquisition';
import { TOPICS } from '../src/lib/discover/types';
import { evaluateDiscover } from './helpers/discover-evaluation';

const input = (changes: Partial<QualityInput> = {}): QualityInput => ({
  title: '今日のできごとを話します',
  description: '日常の雑談です。',
  channelTitle: 'なおの日記',
  durationSeconds: 600,
  captionFlag: false,
  ...changes,
});

test('spoken-Japanese candidates across levels are accepted with explainable reasons', () => {
  for (const changes of [
    {
      title: 'Easy Japanese Podcast #12 ｜ 私の好きな食べ物 (N5-N4)',
      description: 'やさしい日本語で話します。',
    },
    { title: '【夫婦vlog】休日のカフェ巡りと会話', description: '夫婦の日常を撮っています。' },
    {
      title: '【解説】円安はいつまで続く？経済学者が解説',
      description: '経済の専門家がニュースを解説します。',
      durationSeconds: 1260,
    },
    // Bilingual learner content stays eligible: subtitle languages do not change the speech.
    {
      title: 'Slow Japanese: My morning routine (with Japanese & English subtitles)',
      description: '朝のルーティンを話します。',
    },
  ]) {
    const quality = assessQuality(input(changes));
    assert.equal(quality.accepted, true, changes.title);
    assert.ok(quality.score >= QUALITY_THRESHOLD);
    assert.ok(quality.reasons.length > 0);
  }
});
test('other-language lessons, non-Japanese audio and unusable formats are rejected', () => {
  const cases: [Partial<QualityInput>, string][] = [
    [
      {
        title: 'ゆっくり簡単英会話フレーズ（日本語音声付）',
        description: '日本語の後に英語を3回読み上げます。聞き流しもできます。',
        durationSeconds: 6294,
      },
      'foreign-language-audio',
    ],
    [
      {
        title: '中文学习 日常会话 100句',
        description: '学习中文的日常会话',
        durationSeconds: 1200,
      },
      'low-score',
    ],
    [
      {
        title: '【日本語字幕】アイドル 爆笑シーンまとめ',
        description: '韓国語の動画に日本語字幕をつけました',
        defaultAudioLanguage: 'ko',
      },
      'reported-other-audio',
    ],
    [{ title: '【手話初心者向け】日常会話フレーズ集' }, 'sign-language'],
    [{ title: '【無言vlog】一人暮らしの休日' }, 'no-speech'],
    [{ title: '【作業用BGM】カフェ ジャズ', categoryId: '10', durationSeconds: 10800 }, 'music'],
    [{ title: '日本の朝 #shorts', durationSeconds: 45 }, 'too-short'],
    [{ title: '日本語を聞き流し 10時間', durationSeconds: 36000 }, 'too-long'],
    [{ title: '【ゆっくり解説】日本語の起源', description: 'ゆっくり解説です' }, 'low-score'],
  ];
  for (const [changes, reason] of cases)
    assert.equal(assessQuality(input(changes)).rejection, reason, String(changes.title));
});
test('a Japanese explanation about English is downranked, not blacklisted', () => {
  const lesson = input({
    title: '【英語がゆっくり聞こえる！】リスニングのコツ',
    description: '英語耳を作るコツを日本語で解説します。',
    durationSeconds: 1095,
  });
  const plain = assessQuality(lesson);
  assert.ok(plain.reasons.includes('other-language-lesson:-30'));
  assert.equal(plain.rejection, 'low-score');
  // A trusted Japanese transcript is direct evidence of Japanese speech.
  const prepared = assessQuality(lesson, { prepared: true });
  assert.equal(prepared.accepted, true);
  assert.equal(prepared.languageEvidence, 'japanese-transcript');
});
test('language evidence stays uncertain unless something supports it', () => {
  assert.equal(
    assessQuality(input({ defaultAudioLanguage: 'ja' })).languageEvidence,
    'reported-japanese-audio',
  );
  assert.equal(assessQuality(input()).languageEvidence, 'japanese-metadata');
  assert.equal(
    assessQuality(
      input({
        title: 'Learn Japanese with stories',
        description: 'Japanese listening practice',
        channelTitle: 'Story',
      }),
    ).languageEvidence,
    'uncertain',
  );
  // Japanese title metadata and a declared Japanese title language say nothing about the audio.
  assert.equal(
    assessQuality(input({ defaultLanguage: 'ja' })).languageEvidence,
    'japanese-metadata',
  );
  // Orientation needs creator-declared learner markers or declared Japanese audio.
  assert.equal(assessQuality(input()).orientation, null);
  assert.equal(assessQuality(input({ defaultAudioLanguage: 'ja-JP' })).orientation, 'native');
  assert.equal(
    assessQuality(input({ title: 'やさしい日本語で話します', defaultAudioLanguage: 'ja' }))
      .orientation,
    'learner',
  );
});
test('channel history adjusts but never decides alone', () => {
  const base = assessQuality(input()).score;
  assert.equal(
    assessQuality(input(), { channel: { accepted: 0, rejected: 5, prepared: 0 } }).score,
    base - 15,
  );
  assert.equal(
    assessQuality(input(), { channel: { accepted: 0, rejected: 5, prepared: 1 } }).score,
    base + 10,
  );
});
test('assessment is deterministic and order independent', () => {
  const values = [input(), input({ title: '【ゆっくり解説】謎' }), input({ durationSeconds: 90 })];
  const first = values.map((v) => assessQuality(v));
  const second = [...values]
    .reverse()
    .map((v) => assessQuality(v))
    .reverse();
  assert.deepEqual(first, second);
});

const seed = (id: string, changes: Partial<Seed> = {}): Seed => ({
  id,
  topic: 'everyday',
  query: id,
  levelTarget: 'intermediate',
  orientation: 'native',
  runs: 0,
  returned: 0,
  accepted: 0,
  lastRunAt: null,
  ...changes,
});
const NOW = Date.parse('2026-10-10T12:00:00Z');
test('seed choice favours under-covered levels, distinct targets and waiting seeds', () => {
  const seeds = [
    seed('a-intermediate'),
    seed('b-intermediate'),
    seed('c-advanced', { levelTarget: 'advanced' }),
    seed('d-beginner', { levelTarget: 'beginner' }),
  ];
  const coverage = { total: 100, levels: { intermediate: 80, advanced: 20 }, topics: {} };
  const chosen = chooseSeeds(seeds, coverage, NOW).map((s) => s.id);
  assert.deepEqual(chosen, ['d-beginner', 'c-advanced']);
  // With equal coverage, two picks never share a level target while another target is due.
  const even = { total: 90, levels: { beginner: 30, intermediate: 30, advanced: 30 }, topics: {} };
  const pair = chooseSeeds(seeds, even, NOW);
  assert.notEqual(pair[0].levelTarget, pair[1].levelTarget);
  // Waiting time outweighs coverage eventually, so no seed starves.
  const recent = new Date(NOW - 3600000).toISOString();
  const starving = [
    seed('waiting', { lastRunAt: new Date(NOW - 40 * 3600000).toISOString() }),
    seed('popular', { levelTarget: 'beginner', lastRunAt: recent }),
  ];
  assert.equal(chooseSeeds(starving, coverage, NOW, 1)[0].id, 'waiting');
  // Deterministic for shuffled input.
  assert.deepEqual(
    chooseSeeds([...seeds].reverse(), coverage, NOW).map((s) => s.id),
    chosen,
  );
});
test('seed cooldown backs off unproductive searches and order cycles evergreen and fresh', () => {
  assert.equal(seedCooldown(seed('new')), 3600000);
  assert.equal(seedCooldown(seed('good', { runs: 3, returned: 150, accepted: 60 })), 3600000);
  assert.equal(seedCooldown(seed('weak', { runs: 3, returned: 150, accepted: 15 })), 4 * 3600000);
  assert.equal(seedCooldown(seed('poor', { runs: 3, returned: 150, accepted: 3 })), 12 * 3600000);
  assert.deepEqual(
    [0, 1, 2, 3].map((runs) => seedOrder({ runs })),
    ['relevance', 'date', 'viewCount', 'relevance'],
  );
  assert.equal(categoryTopic('25'), 'news');
  assert.equal(categoryTopic('10'), null);
});
test('the migration seed matrix covers every level target and topic with learner and native intent', async () => {
  const sql = await readFile('migrations/0014_discover_acquisition_quality.sql', 'utf8');
  const rows = [...sql.matchAll(/\('([a-z_]+)','([a-z]+)','([^']+)','([a-z]+)','([a-z]+)'\)/g)];
  assert.ok(rows.length >= 24 && rows.length <= 40, `seeds: ${rows.length}`);
  for (const level of LEVEL_TARGETS)
    assert.ok(rows.filter((r) => r[4] === level).length >= 6, level);
  for (const topic of Object.keys(TOPICS))
    assert.ok(
      rows.some((r) => r[2] === topic),
      topic,
    );
  assert.ok(rows.some((r) => r[5] === 'learner') && rows.some((r) => r[5] === 'native'));
  // The seed list must survive the plain semicolon splitter used by local migration checks.
  assert.ok(rows.every((r) => !r[3].includes(';') && r[3].length <= 160));
  assert.ok(!/ゆっくり\s*(会話|解説|実況)'/.test(sql));
});
test('evaluation: acquisition quality improves relevance without losing relevant videos', async () => {
  const result = await evaluateDiscover();
  const [baselineBefore, baselineAfter, matrixBefore, matrixAfter] = result.catalogue;
  assert.ok(baselineBefore.precision < 0.1);
  assert.ok(baselineAfter.precision >= 0.7);
  assert.ok(matrixAfter.precision >= 0.9 && matrixAfter.precision > matrixBefore.precision);
  assert.equal(baselineAfter.recall, 1);
  assert.equal(matrixAfter.recall, 1);
  assert.ok(result.feed.after.p10 >= 0.8 && result.feed.after.p10 > result.feed.before.p10);
  assert.ok(result.feed.after.p24 >= 0.8);
  for (const level of LEVEL_TARGETS) assert.ok(result.levelTargetCoverage[level] >= 5, level);
});
