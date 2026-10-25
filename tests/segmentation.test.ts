import { test } from 'node:test';
import assert from 'node:assert/strict';
import { segmentTranscript, validateCues } from '../src/lib/segmentation';
import { parseSubtitles } from '../src/lib/subtitles';
import { parseYouTubeUrl } from '../src/lib/youtube';
import demo from '../src/data/demo.json';

test('preserves sensible sentence-level timings and authored translations', () => {
  const result = segmentTranscript([
    { start: 0, end: 3.5, text: '今日はいい天気ですね。', translation: 'It’s a nice day.' },
    { start: 4, end: 8, text: '公園へ散歩に行きます。' },
  ]);
  assert.equal(result.length, 2);
  assert.equal(result[0].end, 3.5);
  assert.equal(result[0].translation, 'It’s a nice day.');
});
test('joins short fragments at a clause boundary, but respects silence', () => {
  const result = segmentTranscript([
    { start: 0, end: 1.1, text: '今日は' },
    { start: 1.1, end: 3.5, text: 'コーヒーを飲みます。' },
    { start: 5, end: 6, text: 'そして' },
  ]);
  assert.equal(result[0].japanese, '今日はコーヒーを飲みます。');
  assert.equal(result.length, 2);
});
test('splits long captions at Japanese sentences and flags estimated timing', () => {
  const result = segmentTranscript([
    { start: 0, end: 18, text: '朝は静かです。窓を開けます。鳥の声が聞こえます。' },
  ]);
  assert.ok(result.length > 1);
  assert.ok(result.every((segment) => segment.estimated));
  assert.equal(result[0].start, 0);
  assert.equal(result.at(-1)!.end, 18);
  assert.equal(
    result.map((s) => s.japanese).join(''),
    '朝は静かです。窓を開けます。鳥の声が聞こえます。',
  );
});
test('does not arbitrarily split speech with no linguistic boundary', () => {
  const result = segmentTranscript([
    { start: 0, end: 12, text: 'とても長いけれど途中で自然に区切れない一つの表現です' },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].end, 12);
});
test('deduplicates overlapping rolling captions', () => {
  const result = segmentTranscript([
    { start: 0, end: 2, text: 'おはようございます' },
    { start: 1, end: 3, text: 'おはようございます' },
    { start: 2, end: 5, text: 'おはようございます。今日は晴れです。' },
  ]);
  assert.equal(result.map((s) => s.japanese).join(''), 'おはようございます。今日は晴れです。');
  assert.ok(result.every((s) => s.end > s.start));
});
test('joins overlapping display cues and splits sentence boundaries inside captions', () => {
  const result = segmentTranscript([
    { start: 0, end: 4, text: '皆さんこんにちは。日本語' },
    { start: 2.5, end: 6, text: 'の時間です。今日は' },
    { start: 5, end: 8, text: '公園に行きます。' },
  ]);
  assert.equal(result[0].japanese, '皆さんこんにちは。');
  assert.equal(result[1].japanese, '日本語の時間です。');
  assert.equal(result[2].japanese, '今日は公園に行きます。');
});
test('rejects unsafe and invalid timings and empty transcripts', () => {
  assert.throws(() => validateCues([{ start: -1, end: 2, text: 'こんにちは' }]));
  assert.throws(() => validateCues([{ start: 2, end: 1, text: 'こんにちは' }]));
  assert.throws(() => validateCues([{ start: 0, end: Infinity, text: 'こんにちは' }]));
  assert.throws(() => validateCues([]));
});
test('reads SRT, WebVTT, and JSON without losing Japanese or precision', () => {
  const srt = parseSubtitles(
    '1\r\n00:00:01,250 --> 00:00:04,800\r\nこんにちは。\r\n\r\n2\r\n00:00:05,000 --> 00:00:07,000\r\nお元気ですか。',
  );
  assert.equal(srt[0].start, 1.25);
  assert.equal(srt.length, 2);
  const vtt = parseSubtitles('WEBVTT\n\n00:01.250 --> 00:04.800 align:start\n<b>こんにちは。</b>');
  assert.equal(vtt[0].text, 'こんにちは。');
  assert.equal(vtt[0].end, 4.8);
  const json = parseSubtitles(
    JSON.stringify([{ start: 1, end: 3, japanese: 'こんにちは。', translation: 'Hello.' }]),
  );
  assert.equal(json[0].translation, 'Hello.');
});
test('keeps each ASS speaker turn separate and groups people talking over each other', () => {
  const ass = (lines: string[]) =>
    parseSubtitles(
      [
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        ...lines.map((line) => `Dialogue: 0,${line}`),
      ].join('\n'),
    );
  const turns = segmentTranscript(
    ass([
      '0:10:03.92,0:10:06.72,JP,NTP,0,0,0,,千反田さんがこの部屋に閉じ込められていたことさ',
      '0:10:06.88,0:10:08.32,JP,NTP,0,0,0,,あ そうでした',
    ]),
  );
  assert.deepEqual(
    turns.map((s) => s.japanese),
    ['千反田さんがこの部屋に閉じ込められていたことさ', 'あ そうでした'],
  );
  const overlapping = segmentTranscript(
    ass([
      '0:17:16.02,0:17:16.82,JP,NTP,0,0,0,,折木さん',
      '0:17:16.26,0:17:17.52,JP-ue,NTP,0,0,0,,いいところに来た',
      '0:17:18.40,0:17:20.91,JP,NTP,0,0,0,,今里志から妙な噂を聞いたんだ',
    ]),
  );
  assert.deepEqual(
    overlapping.map((s) => [s.japanese, s.start, s.end]),
    [
      ['折木さん ／ いいところに来た', 1036.02, 1037.52],
      ['今里志から妙な噂を聞いたんだ', 1038.4, 1040.91],
    ],
  );
  const chained = segmentTranscript(
    ass([
      '0:14:22.97,0:14:24.80,JP,NTP,0,0,0,,姉貴よ 満足か',
      '0:14:23.15,0:14:27.69,JP-ue,NTP,0,0,0,,（そうなんですか）',
      '0:14:25.16,0:14:27.16,JP,NTP,0,0,0,,伝統ある古典部の復活',
    ]),
  );
  assert.deepEqual(
    chained.map((s) => s.japanese),
    ['姉貴よ 満足か ／ （そうなんですか）', '伝統ある古典部の復活'],
  );
  // Captions without authored turns still join an unfinished clause to its continuation.
  const captions = segmentTranscript([
    { start: 0, end: 2, text: 'たとえば勉学にもスポーツにも' },
    { start: 2.2, end: 5, text: '色恋沙汰にも興味を示さない' },
  ]);
  assert.equal(captions.length, 1);
});
test('drops invisible direction marks from streaming-service subtitles', () => {
  const [cue] = validateCues([
    { start: 1, end: 2, text: '\u200eグロサリーの&lrm;前出し&#8207;&nbsp;終わりました' },
  ]);
  assert.equal(cue.text, 'グロサリーの前出し 終わりました');
});
test('URL parsing accepts watch, mobile, shorts, embed, live, shortlinks and rejects spoofed hosts', () => {
  for (const url of [
    'https://www.youtube.com/watch?v=IJ6R4u05ppw&list=test',
    'https://youtu.be/IJ6R4u05ppw?t=20',
    'https://m.youtube.com/watch?v=IJ6R4u05ppw',
    'https://youtube.com/shorts/IJ6R4u05ppw',
    'https://youtube.com/embed/IJ6R4u05ppw',
    'https://youtube.com/live/IJ6R4u05ppw',
  ])
    assert.equal(parseYouTubeUrl(url), 'IJ6R4u05ppw');
  for (const url of [
    'https://youtube.com.evil.test/watch?v=IJ6R4u05ppw',
    'https://example.com/',
    'javascript:alert(1)',
    'https://youtube.com/watch?v=bad',
  ])
    assert.throws(() => parseYouTubeUrl(url));
});
test('bundled demo has valid nonoverlapping timings and English for every section', () => {
  validateCues(demo.segments);
  for (let i = 0; i < demo.segments.length; i++) {
    const s = demo.segments[i];
    assert.ok(s.translation && s.japanese);
    assert.ok(s.end - s.start > 2);
    if (i) assert.ok(s.start >= demo.segments[i - 1].end);
  }
});
