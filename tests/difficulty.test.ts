import { installMemoryStorage } from './helpers/memory-storage';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import demo from '../src/data/demo.json';
import authored from '../src/data/demo-difficulty.json';
import {
  calculateSpeechSpeed,
  createDifficultyAnalysis,
  fullDifficultyTranscript,
  validateDifficultyAnalysis,
  validateDifficultyLesson,
} from '../src/lib/difficulty';
import { transcriptKey } from '../src/lib/transcript';
import { loadDifficulty, saveDifficulty } from '../src/lib/storage/learning';
import {
  createWorkersAiDifficultyProvider,
  generateLessonDifficulty,
  WORKERS_AI_DIFFICULTY_MODEL,
} from '../src/lib/providers/difficulty';
import { handleDifficultyRequest } from '../src/lib/difficulty-api';
import { InferenceDenied } from '../src/lib/server/rate-limit';
import type { DifficultyAnalysisProvider, Segment } from '../src/lib/types';

const lesson = validateDifficultyLesson(demo),
  signal = () => new AbortController().signal;
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  installMemoryStorage(memory);
});
function segments(gap: number): Segment[] {
  return [
    { id: 'a', start: 3, end: 13, japanese: 'あ'.repeat(30) + '、？！ abc123' },
    { id: 'b', start: 13 + gap, end: 23 + gap, japanese: '漢'.repeat(30) },
  ];
}
function clefResponse(
  overrides: Partial<Record<'overall' | 'vocabulary' | 'grammar' | 'conversation', string>> = {},
) {
  const choices = {
    overall: overrides.overall ?? 'n4_n3',
    vocabulary: overrides.vocabulary ?? 'intermediate',
    grammar: overrides.grammar ?? 'elementary',
    conversation: overrides.conversation ?? 'intermediate',
  };
  return {
    model: 'clef-flash',
    answers: Object.fromEntries(
      Object.entries(choices).map(([key, choice]) => [
        key,
        {
          type: 'choice',
          choice,
          confidence: 0.52,
          probabilities: { [choice]: 0.8, fallback: 0.2 },
        },
      ]),
    ),
    usage: { input_tokens: 1000, output_tokens: 0 },
  };
}

test('speech pace is deterministic and ignores long pauses', () => {
  assert.equal(calculateSpeechSpeed(segments(0)).value, 180);
  assert.equal(calculateSpeechSpeed(segments(0)).label, 'Moderate');
  assert.equal(calculateSpeechSpeed(segments(1)).value, 171.4);
  assert.equal(calculateSpeechSpeed(segments(20)).excludedGapSeconds, 20);
  assert.equal(calculateSpeechSpeed([]).value, null);
});

test('difficulty input covers the entire Japanese transcript and carries no timestamps or metadata', () => {
  const input = fullDifficultyTranscript(lesson);
  assert.equal(input.coverage.strategyVersion, 2);
  assert.equal(input.coverage.sampledSegments, lesson.segments.length);
  assert.equal(input.coverage.totalSegments, lesson.segments.length);
  assert.ok(input.japanese.includes(lesson.segments[0].japanese));
  assert.ok(input.japanese.includes(lesson.segments.at(-1)!.japanese));
  assert.equal(JSON.stringify(input).includes('"start"'), false);
  assert.equal(JSON.stringify(input).includes('"videoId"'), false);
});

test('compact classifications map to the requested labels and stable learner-profile levels', async () => {
  const analysis = await createDifficultyAnalysis(authored, lesson);
  assert.equal(analysis.overall.label, 'Approximately N5–N4');
  assert.equal(analysis.vocabulary.label, 'Elementary');
  assert.equal(analysis.grammar.label, 'Elementary');
  assert.equal(analysis.conversationalComplexity.label, 'Beginner');
  assert.equal(analysis.vocabulary.examples.length, 0);
  assert.equal(analysis.transcriptKey, await transcriptKey(lesson));
  assert.deepEqual(await validateDifficultyAnalysis(analysis, lesson), analysis);
});

test('new full-coverage strategy invalidates old sampled difficulty caches', async () => {
  const analysis = await createDifficultyAnalysis(authored, lesson);
  await assert.rejects(
    validateDifficultyAnalysis(
      { ...analysis, coverage: { ...analysis.coverage, strategyVersion: 1, sampledSegments: 3 } },
      lesson,
    ),
  );
});

test('difficulty cache survives reload and transcript edits invalidate it', async () => {
  const analysis = await createDifficultyAnalysis(authored, lesson);
  assert.equal(await saveDifficulty(analysis, lesson), true);
  assert.deepEqual(await loadDifficulty(structuredClone(lesson)), analysis);
  const changed = structuredClone(lesson);
  changed.segments[0].japanese += '変更';
  assert.equal(await loadDifficulty(changed), null);
});

test('Clef Flash provider classifies the complete transcript without Qwen or timestamps', async () => {
  const calls: Array<{ model: string; input: Record<string, unknown> }> = [];
  const provider = createWorkersAiDifficultyProvider({
    async run(model, input) {
      calls.push({ model, input });
      return clefResponse();
    },
  });
  const custom = { ...lesson, id: 'custom' };
  const analysis = await generateLessonDifficulty(custom, signal(), provider);
  assert.equal(analysis.lessonId, 'custom');
  assert.equal(analysis.overall.label, 'Approximately N4–N3');
  assert.equal(WORKERS_AI_DIFFICULTY_MODEL, '@cf/cloudflare/clef-flash');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, WORKERS_AI_DIFFICULTY_MODEL);
  assert.equal(typeof calls[0].input.state, 'string');
  assert.ok((calls[0].input.state as string).includes(lesson.segments.at(-1)!.japanese));
  assert.equal(JSON.stringify(calls[0].input).includes('"start"'), false);
  assert.equal(JSON.stringify(calls[0].input).includes('@cf/qwen'), false);
});

test('very long transcripts are fully covered by multiple decision calls and deterministically aggregated', async () => {
  const long = validateDifficultyLesson({
    id: 'long',
    segments: Array.from({ length: 400 }, (_, i) => ({
      id: `s${i}`,
      start: i * 3,
      end: i * 3 + 2,
      japanese: `これは第${i}番の文です。${'日本語'.repeat(40)}`,
    })),
  });
  let calls = 0,
    seenChars = 0;
  const provider = createWorkersAiDifficultyProvider({
    async run(_model, input) {
      calls++;
      seenChars += (input.state as string).replace(/\n/g, '').length;
      return clefResponse(calls === 1 ? { overall: 'n4_n3' } : { overall: 'n3_n2' });
    },
  });
  const analysis = await generateLessonDifficulty(long, signal(), provider);
  assert.ok(calls >= 2);
  assert.ok(seenChars >= fullDifficultyTranscript(long).coverage.totalCharacters);
  assert.ok(['Approximately N4–N3', 'Approximately N3–N2'].includes(analysis.overall.label));
});

test('malformed decision output and binding failures are recoverable', async () => {
  const bad = createWorkersAiDifficultyProvider({
    async run() {
      return { answers: {} };
    },
  });
  await assert.rejects(bad.analyze(fullDifficultyTranscript(lesson), signal()), {
    code: 'malformed',
  });
  const down = createWorkersAiDifficultyProvider({
    async run() {
      throw Error('private upstream detail');
    },
  });
  await assert.rejects(down.analyze(fullDifficultyTranscript(lesson), signal()), {
    code: 'malformed',
  });
});

test('API validates input and semantic failure never blocks the lesson', async () => {
  const request = (input: unknown, origin = 'https://hibiki.test') =>
    new Request('https://hibiki.test/api/difficulty', {
      method: 'POST',
      headers: { origin },
      body: JSON.stringify(input),
    });
  assert.equal((await handleDifficultyRequest(request(lesson, 'https://other.test'))).status, 403);
  assert.equal((await handleDifficultyRequest(request({}))).status, 400);
  const custom = { ...lesson, id: 'custom' };
  const bad: DifficultyAnalysisProvider = {
    name: 'mock',
    async analyze() {
      return { overall: 'bad' };
    },
  };
  const failed = await handleDifficultyRequest(request(custom), bad);
  assert.equal(failed.status, 502);
  assert.equal((await handleDifficultyRequest(request(lesson))).status, 200);
});

test('the inference limit is spent only when a model call actually runs', async () => {
  const request = (input: unknown) =>
    new Request('https://hibiki.test/api/difficulty', {
      method: 'POST',
      headers: { origin: 'https://hibiki.test' },
      body: JSON.stringify(input),
    });
  const denied = Response.json({ code: 'rate-limited' }, { status: 429 });
  let calls = 0;
  // Stands in for limitedInference(): the provider throws once the route's budget is spent.
  const exhausted: DifficultyAnalysisProvider = {
    name: 'exhausted',
    async analyze() {
      calls++;
      throw new InferenceDenied(denied);
    },
  };
  assert.equal((await handleDifficultyRequest(request(lesson), exhausted)).status, 200);
  assert.equal(calls, 0, 'the authored demo never reaches the provider');
  assert.equal(
    await handleDifficultyRequest(request({ ...lesson, id: 'custom' }), exhausted),
    denied,
  );
  assert.equal(calls, 1);
});
