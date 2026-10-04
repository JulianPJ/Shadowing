import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import demo from '../src/data/demo.json';
import questions from '../src/data/demo-quiz.json';
import { alignReading, annotateJapanese, type MorphologicalToken } from '../src/lib/japanese-readings';
import { JapaneseText } from '../src/components/japanese-text';
import { createQuiz, transcriptKey, transcriptRevision, validateQuiz } from '../src/lib/quiz';
import { transcriptHash } from '../src/lib/linked-transcripts';
import type { Lesson } from '../src/lib/types';

const require = createRequire(import.meta.url);
let tokenizer: { tokenize: (text: string) => MorphologicalToken[] };
before(async () => {
  tokenizer = await new Promise((resolve, reject) => require('kuromoji').builder({ dicPath: 'node_modules/kuromoji/dict' }).build((error: unknown, value: typeof tokenizer) => error ? reject(error) : resolve(value)));
});
function readings(text: string) { return annotateJapanese(text, tokenizer.tokenize(text)); }
test('deterministic dictionary readings, inflection and okurigana', () => {
  const examples = [
    ['日本語を勉強しています。', [['日本語', 'にほんご'], ['勉強', 'べんきょう']]],
    ['今日は天気がいいですね。', [['今日', 'きょう'], ['天気', 'てんき']]],
    ['食べました。', [['食', 'た']]],
    ['大丈夫です。', [['大丈夫', 'だいじょうぶ']]],
  ] as const;
  for (const [text, expected] of examples) {
    const tokens = readings(text);
    assert.deepEqual(tokens.filter(t => t.reading).map(t => [t.text, t.reading]), expected);
    assert.equal(tokens.map(t => t.text).join(''), text);
    assert.deepEqual(readings(text), tokens);
  }
  assert.deepEqual(alignReading('食べ', 'たべ'), [{ text: '食', reading: 'た' }, { text: 'べ' }]);
  assert.deepEqual(alignReading('落ち着き', 'おちつき'), [{ text: '落', reading: 'お' }, { text: 'ち' }, { text: '着', reading: 'つ' }, { text: 'き' }]);
});
test('kana, punctuation, mixed scripts, unknown words and exact source preservation', () => {
  for (const text of ['こんにちは。カタカナ！', '日本語 Hello 2026。\n食べました！', '𠮷野XYZ、🙂', ' 今日は、いい天気。 ']) {
    const tokens = readings(text);
    assert.equal(tokens.map(t => t.text).join(''), text);
    assert.ok(tokens.filter(t => t.reading).every(t => /[\p{Script=Han}々〆]/u.test(t.text)));
  }
  assert.equal(readings('こんにちは。カタカナ！').some(t => t.reading), false);
  assert.ok(readings('日本語 Hello 2026。').some(t => t.reading === 'にほんご'));
  assert.deepEqual(annotateJapanese('未知語', [{ surface_form: '未知語', word_type: 'UNKNOWN', reading: 'ミチゴ' }]), [{ text: '未知語' }]);
  assert.deepEqual(annotateJapanese(' 日本語', [{ surface_form: '日本語', word_type: 'KNOWN', reading: 'ニホンゴ' }]), [{ text: ' 日本語' }]);
});
test('default/off renderer is exactly canonical text, with safe plain SSR fallback when on', () => {
  const text = '日本語を勉強しています。';
  assert.equal(renderToStaticMarkup(createElement(JapaneseText, { text })), text);
  assert.equal(renderToStaticMarkup(createElement(JapaneseText, { text, furigana: false })), text);
  assert.ok(!renderToStaticMarkup(createElement(JapaneseText, { text, furigana: true })).includes('<ruby>'));
});
test('annotation leaves Lesson/Segment, shared transcript hash, transcriptKey and quiz evidence unchanged', async () => {
  const lesson = structuredClone(demo) as Lesson;
  const original = JSON.stringify(lesson), key = await transcriptKey(lesson), revision = transcriptRevision(lesson);
  const cues = () => lesson.segments.map(s => ({ start: s.start, end: s.end, text: s.japanese }));
  const hash = await transcriptHash(cues());
  const quiz = await createQuiz(questions, lesson);
  for (const segment of lesson.segments) readings(segment.japanese);
  for (const question of quiz.questions) for (const text of [question.question, ...question.options, question.evidence.quote]) readings(text);
  assert.equal(JSON.stringify(lesson), original);
  assert.equal(await transcriptKey(lesson), key);
  assert.equal(transcriptRevision(lesson), revision);
  assert.equal(await transcriptHash(cues()), hash);
  assert.deepEqual(await validateQuiz(quiz, lesson), quiz);
  assert.ok(lesson.segments.every(s => !('reading' in s) && !('furigana' in s)));
});
