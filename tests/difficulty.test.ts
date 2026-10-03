import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import demo from '../src/data/demo.json';
import authored from '../src/data/demo-difficulty.json';
import { calculateSpeechSpeed, createDifficultyAnalysis, sampleDifficultyTranscript, validateDifficultyAnalysis, validateDifficultyLesson } from '../src/lib/difficulty';
import { transcriptKey, validateQuizLesson } from '../src/lib/quiz';
import { completeLesson, lessonCompleted, loadDifficulty, loadQuiz, readStorage, saveDifficulty, saveLesson, saveQuiz } from '../src/lib/storage';
import { createQuiz } from '../src/lib/quiz';
import quizData from '../src/data/demo-quiz.json';
import { createWorkersAiDifficultyProvider, generateLessonDifficulty, WORKERS_AI_DIFFICULTY_MODEL } from '../src/lib/providers/difficulty';
import { handleDifficultyRequest } from '../src/lib/difficulty-api';
import type { DifficultyAnalysisProvider, Segment } from '../src/lib/types';

const lesson = validateDifficultyLesson(demo), signal = () => new AbortController().signal;
const demoLesson = { ...demo, source: 'demo' as const };
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } });
});
function segments(gap: number): Segment[] {
  return [{ id: 'a', start: 3, end: 13, japanese: 'あ'.repeat(30) + '、？！ abc123' }, { id: 'b', start: 13 + gap, end: 23 + gap, japanese: '漢'.repeat(30) }];
}
test('speech pace counts Japanese code points, excludes punctuation/Latin text and leading/trailing silence', () => {
  const pace = calculateSpeechSpeed(segments(0));
  assert.equal(pace.value, 180); assert.equal(pace.activeSeconds, 20); assert.equal(pace.japaneseCharacters, 60);
  assert.equal(pace.label, 'Moderate');
  const halfwidth = segments(0); halfwidth[0].japanese = 'ｶ'.repeat(30);
  assert.equal(calculateSpeechSpeed(halfwidth).japaneseCharacters, 60);
});
test('short pauses count, long pauses are excluded entirely; invalid and short transcripts never invent a rate', () => {
  assert.equal(calculateSpeechSpeed(segments(1)).value, 171.4);
  assert.equal(calculateSpeechSpeed(segments(20)).value, 180);
  assert.equal(calculateSpeechSpeed(segments(20)).excludedGapSeconds, 20);
  for (const s of [[], segments(0).slice(0, 1), [{ id: 'x', start: 0, end: 1, japanese: 'あ'.repeat(40) }], [{ id: 'x', start: 0, end: NaN, japanese: 'あ'.repeat(40) }], [{ id: 'x', start: 0, end: 20, japanese: 'hello world' }]]) assert.equal(calculateSpeechSpeed(s).value, null);
});
test('speech labels have documented deterministic boundaries', () => {
  for (const [rate, label] of [[179, 'Slow'], [180, 'Moderate'], [260, 'Natural conversational'], [340, 'Fast'], [420, 'Very fast']] as const) {
    const s = segments(0); s[0].japanese = 'あ'.repeat(rate); s[1].japanese = 'あ'.repeat(rate); s[0].end = 63; s[1].start = 63; s[1].end = 123;
    assert.equal(calculateSpeechSpeed(s).label, label);
  }
});
test('analysis uses application labels and timestamps, compact exact evidence and stable portable identity', async () => {
  const analysis = await createDifficultyAnalysis(authored, lesson);
  assert.equal(analysis.overall.label, 'Approximately N5–N4');
  assert.equal(analysis.grammar.label, 'Elementary');
  assert.equal(analysis.grammar.examples[0].start, demo.segments[5].start);
  assert.equal(analysis.grammar.examples[0].end, demo.segments[5].end);
  assert.equal(analysis.transcriptKey, await transcriptKey(lesson));
  assert.equal((await createDifficultyAnalysis(authored, lesson)).id, analysis.id);
  assert.deepEqual(await validateDifficultyAnalysis(analysis, lesson), analysis);
});
test('JLPT validation accepts ordered ranges and rejects reversed or unknown values', async () => {
  const levels = ['N5', 'N4', 'N3', 'N2', 'N1'];
  for (let min = 0; min < 5; min++) for (let max = 0; max < 5; max++) {
    const value = structuredClone(authored); value.overall.jlptMin = levels[min]; value.overall.jlptMax = levels[max];
    if (max < min) await assert.rejects(createDifficultyAnalysis(value, lesson)); else await createDifficultyAnalysis(value, lesson);
  }
  for (const bad of ['N0', 'N6', 'n3', 3, null]) await assert.rejects(createDifficultyAnalysis({ ...authored, overall: { ...authored.overall, jlptMin: bad } }, lesson));
});
test('strict schema rejects invalid scores, missing/long explanations, extra fields, unsupported/fabricated/duplicate evidence', async () => {
  const mutations = [
    (v: typeof authored) => { v.grammar.level = 0; },
    (v: typeof authored) => { v.grammar.level = 6; },
    (v: typeof authored) => { v.grammar.level = 1.5; },
    (v: typeof authored) => { v.grammar.level = NaN; },
    (v: typeof authored) => { v.grammar.explanation = ''; },
    (v: typeof authored) => { v.overall.explanation = 'x'.repeat(451); },
    (v: typeof authored) => { v.overall.confidence = 'certain'; },
    (v: typeof authored) => { Object.assign(v, { speechSpeed: 100 }); },
    (v: typeof authored) => { Object.assign(v.grammar, { invented: true }); },
    (v: typeof authored) => { v.grammar.examples[0].quote = 'fabricated text'; },
    (v: typeof authored) => { v.grammar.examples[0].segmentId = 'absent'; },
    (v: typeof authored) => { Object.assign(v.grammar.examples[0], { start: 0 }); },
    (v: typeof authored) => { v.grammar.examples = [v.grammar.examples[0], v.grammar.examples[0]]; },
    (v: typeof authored) => { v.vocabulary.examples = []; },
    (v: typeof authored) => { Reflect.deleteProperty(v.overall, 'confidence'); },
  ];
  for (const mutate of mutations) { const v = structuredClone(authored); mutate(v); await assert.rejects(createDifficultyAnalysis(v, lesson)); }
});
test('sampling covers beginning, middle and end; large input stays bounded with context windows', () => {
  const long = { id: 'long', segments: Array.from({ length: 10000 }, (_, i) => ({ id: `${i}`, start: i * 2, end: i * 2 + 1, japanese: 'あ'.repeat(5000) })) };
  const sample = sampleDifficultyTranscript(long);
  assert.equal(sample.windows.length, 12); assert.equal(sample.coverage.sampledSegments, 36); assert.equal(sample.coverage.sampledCharacters, 9000);
  assert.equal(sample.windows[0][0].id, '0'); assert.equal(sample.windows.at(-1)!.at(-1)!.id, '9999');
  assert.ok(sample.windows.some(w => Number(w[0].id) > 4000 && Number(w[0].id) < 6000));
  assert.deepEqual(sampleDifficultyTranscript(long), sample);
  assert.equal(sampleDifficultyTranscript(lesson).coverage.sampledSegments, 14);
});
test('difficulty accepts long normalized lessons while retaining original quiz bounds', () => {
  const long = { id: 'long', segments: Array.from({ length: 2500 }, (_, i) => ({ id: `${i}`, start: i * 2, end: i * 2 + 1, japanese: 'あ'.repeat(40) })) };
  assert.equal(validateDifficultyLesson(long).segments.length, 2500);
  assert.throws(() => validateQuizLesson(long));
  assert.throws(() => validateDifficultyLesson({ ...long, segments: [long.segments[0], long.segments[0]] }));
});
test('model cannot cite an unsampled section; sampling and short material cap confidence', async () => {
  const extended = { ...lesson, segments: Array.from({ length: 200 }, (_, i) => ({ id: `s${i}`, start: i * 10, end: i * 10 + 8, japanese: 'コーヒーを飲みながら、今日の予定を考えます。' })) };
  const value = structuredClone(authored); value.overall.confidence = 'high';
  for (const d of [value.vocabulary, value.grammar, value.conversationalComplexity]) d.examples = [{ segmentId: 's0', quote: 'コーヒーを飲みながら', explanation: 'Connected everyday actions.' }];
  assert.equal((await createDifficultyAnalysis(value, extended)).overall.confidence, 'medium');
  value.grammar.examples[0].segmentId = 's4'; await assert.rejects(createDifficultyAnalysis(value, extended));
  const short = { ...lesson, segments: lesson.segments.slice(0, 2) };
  const simple = structuredClone(value); for (const d of [simple.vocabulary, simple.grammar, simple.conversationalComplexity]) d.examples = [{ segmentId: short.segments[0].id, quote: 'おはようございます', explanation: 'A polite greeting.' }];
  assert.equal((await createDifficultyAnalysis(simple, short)).overall.confidence, 'low');
});
test('cache survives reload and ignores media changes; text/timing/identity/schema changes invalidate it', async () => {
  const analysis = await createDifficultyAnalysis(authored, lesson);
  assert.equal(await saveDifficulty(analysis, lesson), true);
  assert.deepEqual(await loadDifficulty(structuredClone(lesson)), analysis);
  const padded = { ...lesson, segments: lesson.segments.map(s => ({ ...s, japanese: ` ${s.japanese} ` })) };
  assert.deepEqual(await loadDifficulty(padded), analysis);
  assert.deepEqual(await loadDifficulty({ ...lesson, videoId: 'different-media' }), analysis);
  for (const edit of ['text', 'timing', 'segment', 'lesson'] as const) {
    const changed = structuredClone(lesson);
    if (edit === 'text') changed.segments[0].japanese += '変更';
    if (edit === 'timing') changed.segments[0].start = 0.1;
    if (edit === 'segment') changed.segments[0].id = 'edited';
    if (edit === 'lesson') changed.id = 'other';
    assert.equal(await loadDifficulty(changed), null);
  }
  for (const modified of [{ ...analysis, schemaVersion: 2 }, { ...analysis, generatedAt: 'bad' }, { ...analysis, speechSpeed: { ...analysis.speechSpeed, value: 999 } }, { ...analysis, coverage: { ...analysis.coverage, sampledSegments: 999 } }]) await assert.rejects(validateDifficultyAnalysis(modified, lesson));
  memory.set('hibiki:v1:difficulty:demo', '{broken'); assert.equal(await loadDifficulty(lesson), null);
});
test('storage failure is non-blocking and analysis does not duplicate the transcript', async () => {
  const analysis = await createDifficultyAnalysis(authored, lesson); await saveDifficulty(analysis, lesson);
  assert.ok(!memory.get('hibiki:v1:difficulty:demo')!.includes(demo.segments[0].japanese));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } } });
  assert.equal(await loadDifficulty(lesson), null); assert.equal(await saveDifficulty(analysis, lesson), false);
  assert.doesNotThrow(() => saveLesson(demoLesson, 0));
});
test('Workers AI adapter uses Qwen, bounded JSON, low temperature and explicit no-think prompting with a mocked binding', async () => {
  let calls = 0;
  const provider = createWorkersAiDifficultyProvider({ async run(model, input, options) {
    calls++; assert.equal(model, WORKERS_AI_DIFFICULTY_MODEL); assert.equal(model, '@cf/qwen/qwen3-30b-a3b-fp8'); assert.equal(input.max_completion_tokens, 2200);
    assert.deepEqual(input.response_format, { type: 'json_object' }); assert.equal(input.chat_template_kwargs, undefined);
    assert.equal(input.temperature, 0.1); assert.deepEqual(options, { rejectIfBusy: true });
    const messages = input.messages as Array<{ content: string }>; assert.ok(messages[1].content.endsWith('/no_think'));
    return { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(authored) } }] };
  } });
  const analysis = await generateLessonDifficulty({ ...lesson, id: 'custom' }, signal(), provider);
  assert.equal(analysis.lessonId, 'custom'); assert.equal(calls, 1);
  await generateLessonDifficulty(lesson, signal(), provider); assert.equal(calls, 1);
});
test('difficulty accepts Workers AI direct JSON response objects', async () => {
  const provider = createWorkersAiDifficultyProvider({ async run() {
    return { response: authored, choices: [{ finish_reason: 'stop', message: { content: null, reasoning: 'provider-internal reasoning' } }] };
  } });
  const analysis = await generateLessonDifficulty({ ...lesson, id: 'direct-json' }, signal(), provider);
  assert.equal(analysis.lessonId, 'direct-json');
});

test('malformed JSON, incomplete output, oversized content and binding failures are recoverable', async () => {
  for (const response of [{}, { choices: [] }, { choices: [{ finish_reason: 'length', message: { content: '{}' } }] }, { choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] }, { choices: [{ finish_reason: 'stop', message: { content: 'x'.repeat(24001) } }] }]) {
    const provider = createWorkersAiDifficultyProvider({ async run() { return response; } });
    await assert.rejects(provider.analyze(sampleDifficultyTranscript(lesson), signal()), { code: 'malformed' });
  }
  const provider = createWorkersAiDifficultyProvider({ async run() { throw Error('secret-provider-internals'); } });
  await assert.rejects(provider.analyze(sampleDifficultyTranscript(lesson), signal()), { code: 'unavailable' });
});
test('timeouts stop waiting for stuck native binding calls and pre-cancelled requests do not call it', async () => {
  let calls = 0;
  const provider = createWorkersAiDifficultyProvider({ run() { calls++; return new Promise(() => {}); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(provider.analyze(sampleDifficultyTranscript(lesson), controller.signal), { code: 'unavailable' }); assert.equal(calls, 0);
  const pending = new AbortController(); const operation = provider.analyze(sampleDifficultyTranscript(lesson), pending.signal);
  await new Promise(resolve => setTimeout(resolve, 5)); pending.abort();
  await assert.rejects(operation, { code: 'unavailable' }); assert.equal(calls, 1);
});
test('API validates origin/body, gives safe errors and leaves lesson/completion/quiz persistence intact', async () => {
  const custom = { ...lesson, id: 'custom' };
  const request = (input: unknown, origin = 'https://hibiki.test') => new Request('https://hibiki.test/api/difficulty', { method: 'POST', headers: { origin }, body: JSON.stringify(input) });
  assert.equal((await handleDifficultyRequest(request(lesson, 'https://other.test'))).status, 403);
  assert.equal((await handleDifficultyRequest(request({}))).status, 400);
  assert.equal((await handleDifficultyRequest(request({ ...custom, segments: custom.segments.slice(0, 1) }))).status, 422);
  const bad: DifficultyAnalysisProvider = { name: 'mock', async analyze() { throw Error('SECRET internal model prompt'); } };
  saveLesson(demoLesson, 3); completeLesson(lesson); const quiz = await createQuiz(quizData, lesson); saveQuiz(quiz);
  const failed = await handleDifficultyRequest(request(custom), bad);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('SECRET'));
  assert.equal(lessonCompleted(lesson), true); assert.deepEqual(await loadQuiz(lesson), quiz); assert.equal(readStorage('position:demo', 0), 3);
  const malformed: DifficultyAnalysisProvider = { name: 'mock', async analyze() { return { overall: {} }; } };
  assert.equal((await handleDifficultyRequest(request(custom), malformed)).status, 502);
  assert.equal((await handleDifficultyRequest(request(lesson))).status, 200);
});
