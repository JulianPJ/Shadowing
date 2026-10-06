import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import demo from '../src/data/demo.json';
import type { MorphologicalToken } from '../src/lib/japanese-readings';
import { rankTopicVocabulary } from '../src/lib/topic-vocabulary';
import type { Segment } from '../src/lib/types';

const require = createRequire(import.meta.url);
let tokenizer: { tokenize: (text: string) => MorphologicalToken[] };

before(async () => {
  tokenizer = await new Promise((resolve, reject) =>
    require('kuromoji')
      .builder({ dicPath: 'node_modules/kuromoji/dict' })
      .build((error: unknown, value: typeof tokenizer) => (error ? reject(error) : resolve(value))),
  );
});

test('demo topic vocabulary favors recurring subject words and rejects generic language', () => {
  const analysis = rankTopicVocabulary(
    demo.segments,
    demo.segments.map((segment) => tokenizer.tokenize(segment.japanese)),
  );
  const terms = analysis.items.map((item) => item.term);
  assert.ok(terms.includes('コーヒー'));
  assert.ok(terms.includes('公園'));
  assert.ok(terms.includes('朝'));
  assert.ok(!terms.includes('今日'));
  assert.ok(!terms.includes('する'));
  assert.ok(!terms.includes('思う'));
  assert.ok(analysis.items.every((item) => item.score >= analysis.threshold));
});

test('equal-frequency vocabulary ranks higher when it is spread across the video', () => {
  const segments: Segment[] = Array.from({ length: 6 }, (_, index) => ({
    id: `s${index}`,
    start: index * 10,
    end: index * 10 + 5,
    japanese: `文${index}`,
  }));
  const token = (surface_form: string): MorphologicalToken => ({
    surface_form,
    basic_form: surface_form,
    pos: '名詞',
    pos_detail_1: '一般',
    word_type: 'KNOWN',
    reading: surface_form === '発酵' ? 'ハッコウ' : 'ジテンシャ',
  });
  const analyzed = segments.map(() => [] as MorphologicalToken[]);
  analyzed[0] = [token('発酵')];
  analyzed[5] = [token('発酵')];
  analyzed[2] = [token('自転車')];
  analyzed[3] = [token('自転車')];

  const analysis = rankTopicVocabulary(segments, analyzed, { threshold: 0, maxItems: 20 });
  const fermentation = analysis.items.find((item) => item.term === '発酵')!;
  const bicycle = analysis.items.find((item) => item.term === '自転車')!;
  assert.equal(fermentation.occurrences, bicycle.occurrences);
  assert.ok(fermentation.dispersionScore > bicycle.dispersionScore);
  assert.ok(fermentation.score > bicycle.score);
});

test('repeated noun compounds replace redundant component words', () => {
  const segments: Segment[] = Array.from({ length: 5 }, (_, index) => ({
    id: `s${index}`,
    start: index * 10,
    end: index * 10 + 5,
    japanese: index === 0 || index === 4 ? '政策金利' : '別の文',
  }));
  const noun = (surface_form: string, reading: string): MorphologicalToken => ({
    surface_form,
    basic_form: surface_form,
    pos: '名詞',
    pos_detail_1: '一般',
    word_type: 'KNOWN',
    reading,
  });
  const analyzed = segments.map(() => [] as MorphologicalToken[]);
  analyzed[0] = [noun('政策', 'セイサク'), noun('金利', 'キンリ')];
  analyzed[4] = [noun('政策', 'セイサク'), noun('金利', 'キンリ')];

  const analysis = rankTopicVocabulary(segments, analyzed, { threshold: 0, maxItems: 20 });
  const terms = analysis.items.map((item) => item.term);
  assert.ok(terms.includes('政策金利'));
  assert.ok(!terms.includes('政策'));
  assert.ok(!terms.includes('金利'));
  assert.equal(analysis.items.find((item) => item.term === '政策金利')?.reading, 'せいさくきんり');
});

test('threshold selection does not pad weak vocabulary to a fixed list length', () => {
  const segments: Segment[] = [
    { id: 's1', start: 0, end: 5, japanese: '窓' },
    { id: 's2', start: 5, end: 10, japanese: '鳥' },
  ];
  const noun = (surface_form: string): MorphologicalToken => ({
    surface_form,
    basic_form: surface_form,
    pos: '名詞',
    pos_detail_1: '一般',
    word_type: 'KNOWN',
  });
  const analysis = rankTopicVocabulary(segments, [[noun('窓')], [noun('鳥')]]);
  assert.deepEqual(analysis.items, []);
});
