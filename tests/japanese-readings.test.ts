import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import demo from '../src/data/demo.json';
import questions from '../src/data/demo-quiz.json';
import {
  alignReading,
  annotateJapanese,
  type MorphologicalToken,
} from '../src/lib/japanese-readings';
import { runJapaneseWorkerRequest } from '../src/lib/japanese-analysis-worker';
import { JapaneseText } from '../src/components/japanese-text';
import { createQuiz, transcriptKey, transcriptRevision, validateQuiz } from '../src/lib/quiz';
import { transcriptHash } from '../src/lib/linked-transcripts';
import type { Lesson } from '../src/lib/types';
import { japaneseLexicalSpans } from '../src/lib/japanese-lexical-spans';
import { lookupCandidates } from '../src/lib/lexicon/lookup';

const require = createRequire(import.meta.url);
let tokenizer: { tokenize: (text: string) => MorphologicalToken[] };
before(async () => {
  tokenizer = await new Promise((resolve, reject) =>
    require('kuromoji')
      .builder({ dicPath: 'node_modules/kuromoji/dict' })
      .build((error: unknown, value: typeof tokenizer) => (error ? reject(error) : resolve(value))),
  );
});
function readings(text: string) {
  return annotateJapanese(text, tokenizer.tokenize(text));
}
test('canonical lookup spans retain inflected forms and source offsets across display views', () => {
  for (const [sentence, surface, lemma] of [
    ['日本語を話せます。', '話せます', '話せる'],
    ['日本語を勉強しています。', '勉強しています', '勉強'],
    ['食べませんでした。', '食べませんでした', '食べる'],
    ['読んでいます。', '読んでいます', '読む'],
    ['行きたくなかった。', '行きたくなかった', '行く'],
    ['高くないです。', '高くないです', '高い'],
    ['静かでした。', '静かでした', '静か'],
  ]) {
    const morphology = tokenizer.tokenize(sentence);
    const spans = japaneseLexicalSpans(sentence, morphology);
    assert.equal(spans.map((span) => span.text).join(''), sentence);
    const span = spans.find((value) => value.text === surface);
    assert.ok(span, surface);
    assert.equal(span.lemma, lemma);
    assert.equal(sentence.slice(span.start, span.end), surface);
    assert.equal(
      annotateJapanese(span.text, span.tokens)
        .map((value) => value.text)
        .join(''),
      surface,
    );
    assert.ok(lookupCandidates(surface, morphology).includes(lemma));
    if (sentence.startsWith('日本語'))
      assert.equal(spans.find((value) => value.text === 'を')?.text, 'を');
  }
  assert.ok(japaneseLexicalSpans('日本語を話せます。').some((span) => span.text === '話せます'));
  assert.deepEqual(lookupCandidates('日本語を話せます', tokenizer.tokenize('日本語を話せます。')), [
    '日本語を話せます',
  ]);
  for (const text of [' 日本語\nHello🙂。 ', '食べました。', '𠮷野XYZ'])
    assert.equal(
      japaneseLexicalSpans(text, tokenizer.tokenize('違う'))
        .map((span) => span.text)
        .join(''),
      text,
    );
});
test('deterministic dictionary readings, inflection and okurigana', () => {
  const examples = [
    [
      '日本語を勉強しています。',
      [
        ['日本語', 'にほんご'],
        ['勉強', 'べんきょう'],
      ],
    ],
    [
      '今日は天気がいいですね。',
      [
        ['今日', 'きょう'],
        ['天気', 'てんき'],
      ],
    ],
    ['食べました。', [['食', 'た']]],
    ['大丈夫です。', [['大丈夫', 'だいじょうぶ']]],
  ] as const;
  for (const [text, expected] of examples) {
    const tokens = readings(text);
    assert.deepEqual(
      tokens.filter((t) => t.reading).map((t) => [t.text, t.reading]),
      expected,
    );
    assert.equal(tokens.map((t) => t.text).join(''), text);
    assert.deepEqual(readings(text), tokens);
  }
  assert.deepEqual(alignReading('食べ', 'たべ'), [{ text: '食', reading: 'た' }, { text: 'べ' }]);
  assert.deepEqual(alignReading('落ち着き', 'おちつき'), [
    { text: '落', reading: 'お' },
    { text: 'ち' },
    { text: '着', reading: 'つ' },
    { text: 'き' },
  ]);
});
test('kana, punctuation, mixed scripts, unknown words and exact source preservation', () => {
  for (const text of [
    'こんにちは。カタカナ！',
    '日本語 Hello 2026。\n食べました！',
    '𠮷野XYZ、🙂',
    ' 今日は、いい天気。 ',
  ]) {
    const tokens = readings(text);
    assert.equal(tokens.map((t) => t.text).join(''), text);
    assert.ok(tokens.filter((t) => t.reading).every((t) => /[\p{Script=Han}々〆]/u.test(t.text)));
  }
  assert.equal(
    readings('こんにちは。カタカナ！').some((t) => t.reading),
    false,
  );
  assert.ok(readings('日本語 Hello 2026。').some((t) => t.reading === 'にほんご'));
  assert.deepEqual(
    annotateJapanese('未知語', [
      { surface_form: '未知語', word_type: 'UNKNOWN', reading: 'ミチゴ' },
    ]),
    [{ text: '未知語' }],
  );
  assert.deepEqual(
    annotateJapanese(' 日本語', [
      { surface_form: '日本語', word_type: 'KNOWN', reading: 'ニホンゴ' },
    ]),
    [{ text: ' 日本語' }],
  );
});
test('default/off renderer is exactly canonical text, with safe plain SSR fallback when on', () => {
  const text = '日本語を勉強しています。';
  assert.equal(renderToStaticMarkup(createElement(JapaneseText, { text })), text);
  assert.equal(renderToStaticMarkup(createElement(JapaneseText, { text, furigana: false })), text);
  assert.ok(
    !renderToStaticMarkup(createElement(JapaneseText, { text, furigana: true })).includes('<ruby>'),
  );
});
test('annotation leaves Lesson/Segment, shared transcript hash, transcriptKey and quiz evidence unchanged', async () => {
  const lesson = structuredClone(demo) as Lesson;
  const original = JSON.stringify(lesson),
    key = await transcriptKey(lesson),
    revision = transcriptRevision(lesson);
  const cues = () => lesson.segments.map((s) => ({ start: s.start, end: s.end, text: s.japanese }));
  const hash = await transcriptHash(cues());
  const quiz = await createQuiz(questions, lesson);
  for (const segment of lesson.segments) readings(segment.japanese);
  for (const question of quiz.questions)
    for (const text of [question.question, ...question.options, question.evidence.quote])
      readings(text);
  assert.equal(JSON.stringify(lesson), original);
  assert.equal(await transcriptKey(lesson), key);
  assert.equal(transcriptRevision(lesson), revision);
  assert.equal(await transcriptHash(cues()), hash);
  assert.deepEqual(await validateQuiz(quiz, lesson), quiz);
  assert.ok(lesson.segments.every((s) => !('reading' in s) && !('furigana' in s)));
});

test('shared batch analysis preserves Kuromoji morphology, readings and exact independent sentence context', async () => {
  const fields: (keyof MorphologicalToken)[] = [
    'surface_form',
    'reading',
    'word_type',
    'basic_form',
    'pos',
    'pos_detail_1',
    'pos_detail_2',
    'pos_detail_3',
    'conjugated_type',
    'conjugated_form',
    'pronunciation',
  ];
  const corpus = [
    '日本語を勉強しています。',
    '今日は天気がいいですね。',
    '政策金利を下げました。',
    'こんにちは。カタカナ！',
    ' 今日は、いい天気。 ',
    '日本語 Hello 2026。\r\n食べました！',
    '𠮷野XYZ、🙂',
    '私\tは静かに話す。',
  ];
  const response = await runJapaneseWorkerRequest(
    {
      id: 1,
      kind: 'morphology-batch',
      items: corpus.map((text, index) => ({ id: index, text })),
    },
    async () => tokenizer,
  );
  assert.ok('results' in response);
  if (!('results' in response) || !response.results) throw new Error('Expected batch results');
  for (let index = 0; index < corpus.length; index++) {
    const text = corpus[index];
    const expected = tokenizer
      .tokenize(text)
      .map((token) =>
        Object.fromEntries(
          fields.filter((field) => token[field]).map((field) => [field, token[field]]),
        ),
      );
    assert.equal(response.results[index].id, index);
    assert.deepEqual(response.results[index].tokens, expected);
    assert.deepEqual(annotateJapanese(text, response.results[index].tokens), readings(text));
  }
  const legacy = await runJapaneseWorkerRequest({ id: 2, text: corpus[0] }, async () => tokenizer);
  assert.ok('tokens' in legacy);
  if ('tokens' in legacy) assert.deepEqual(legacy.tokens, readings(corpus[0]));
});

test('worker rejects over-budget/duplicate batches before tokenizer work and reports engine failures', async () => {
  let loaded = 0;
  const loader = async () => {
    loaded++;
    return tokenizer;
  };
  for (const items of [
    Array.from({ length: 9 }, (_, id) => ({ id, text: '日本語' })),
    [
      { id: 1, text: '甲'.repeat(3000) },
      { id: 2, text: '乙'.repeat(3000) },
    ],
    [
      { id: 1, text: '日本語' },
      { id: 1, text: '天気' },
    ],
  ]) {
    assert.deepEqual(
      await runJapaneseWorkerRequest({ id: 1, kind: 'morphology-batch', items }, loader),
      { id: 1, kind: 'morphology-batch', error: true },
    );
  }
  assert.equal(loaded, 0);
  assert.deepEqual(
    await runJapaneseWorkerRequest({ id: 2, kind: 'morphology', text: '日本語' }, async () => {
      throw new Error('dictionary missing');
    }),
    { id: 2, kind: 'morphology', error: true },
  );
});
