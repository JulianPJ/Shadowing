import { test } from 'node:test';
import assert from 'node:assert/strict';
import { japaneseMorphology, japaneseReadings } from '../src/lib/furigana-client';
import { analyzeJapanese, analyzeJapaneseBatch } from '../src/lib/japanese-analysis';
import {
  JAPANESE_BATCH_MAX_CHARACTERS,
  JAPANESE_BATCH_MAX_ITEMS,
  type JapaneseWorkerRequest,
  type JapaneseWorkerResponse,
} from '../src/lib/japanese-analysis-protocol';
import type { MorphologicalToken } from '../src/lib/japanese-readings';
import { lessonTokens } from '../src/lib/knowledge/lesson';
import { analyzeTopicVocabulary } from '../src/lib/topic-vocabulary-client';
import { rankTopicVocabulary } from '../src/lib/topic-vocabulary';
import type { Lesson } from '../src/lib/types';
import demo from '../src/data/demo.json';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const tokens = (text: string): MorphologicalToken[] => [
  {
    surface_form: text,
    basic_form: text,
    reading: text === '日本語' ? 'ニホンゴ' : 'キンリ',
    word_type: 'KNOWN',
    pos: '名詞',
    pos_detail_1: '一般',
  },
];
class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: JapaneseWorkerRequest[] = [];
  answered = 0;
  onmessage?: (event: { data: JapaneseWorkerResponse }) => void;
  onerror?: () => void;
  terminated = false;
  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: JapaneseWorkerRequest) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  replyNext() {
    const request = this.messages[this.answered++];
    assert.ok(request, 'expected a pending worker message');
    this.onmessage?.({
      data:
        request.kind === 'morphology-batch'
          ? {
              id: request.id,
              kind: request.kind,
              // Reply out of order to verify correlation by per-item ID.
              results: [...request.items]
                .reverse()
                .map((item) => ({ id: item.id, tokens: tokens(item.text) })),
            }
          : { id: request.id, tokens: tokens(request.text) },
    });
  }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
const currentWorker = () => FakeWorker.instances.at(-1)!;
async function complete<T>(promise: Promise<T>) {
  let done = false;
  void promise.then(
    () => (done = true),
    () => (done = true),
  );
  for (let i = 0; !done && i < 100; i++) {
    await tick();
    const worker = currentWorker();
    if (worker.answered < worker.messages.length) worker.replyNext();
  }
  assert.ok(done, 'analysis should finish in bounded windows');
  return promise;
}

test('furigana stays lazy and readings/morphology share one canonical tokenization', async () => {
  assert.deepEqual(await japaneseReadings('こんにちは。'), [{ text: 'こんにちは。' }]);
  assert.equal(FakeWorker.instances.length, 0);
  const first = japaneseReadings('日本語');
  assert.equal(japaneseReadings('日本語'), first);
  const morphology = japaneseMorphology('日本語');
  await tick();
  const worker = currentWorker();
  assert.equal(worker.url, '/furigana/v1/worker.js');
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].kind, 'morphology');
  worker.replyNext();
  assert.deepEqual(await first, [{ text: '日本語', reading: 'にほんご' }]);
  assert.deepEqual(await morphology, tokens('日本語'));
  assert.equal(japaneseReadings('日本語'), first);
  assert.equal(japaneseMorphology('日本語'), morphology);
  const differentSource = japaneseMorphology(' 日本語');
  await complete(differentSource);
  assert.equal(worker.messages.length, 2, 'source whitespace remains significant');
});

test('a failed worker evicts pending analysis and permits a lazy retry', async () => {
  const first = japaneseReadings('天気');
  const morphology = japaneseMorphology('天気');
  const failureChecks = Promise.all([
    assert.rejects(first, /unavailable/),
    assert.rejects(morphology, /unavailable/),
  ]);
  await tick();
  const worker = currentWorker();
  worker.onerror?.();
  await failureChecks;
  assert.ok(worker.terminated);
  const retry = japaneseMorphology('天気');
  await complete(retry);
  assert.notEqual(currentWorker(), worker);
  worker.onerror?.();
  assert.ok(!currentWorker().terminated, 'an old worker error cannot terminate its replacement');
});

test('malformed morphology invalidates the worker instead of poisoning cached display views', async () => {
  const request = japaneseReadings('破損応答');
  const rejection = assert.rejects(request, /unavailable/);
  await tick();
  const worker = currentWorker();
  const message = worker.messages[worker.answered++];
  worker.onmessage?.({
    data: {
      id: message.id,
      kind: 'morphology',
      tokens: [{ surface_form: '破損応答', reading: 123 }],
    },
  });
  await rejection;
  assert.ok(worker.terminated);
  await complete(japaneseMorphology('破損応答'));
});

test('malformed batch envelopes fail promptly and allow retry instead of leaving pending work', async () => {
  for (const invalid of [null, { results: [null] }, { results: [{ id: 'invalid' }] }]) {
    const text = `不正な構造${JSON.stringify(invalid)}`;
    const one = japaneseMorphology(text);
    const two = japaneseMorphology(`${text}二`);
    const rejection = Promise.all([
      assert.rejects(one, /unavailable/),
      assert.rejects(two, /unavailable/),
    ]);
    await tick();
    const worker = currentWorker();
    const message = worker.messages[worker.answered++];
    assert.equal(message.kind, 'morphology-batch');
    worker.onmessage?.({
      data: (invalid && {
        id: message.id,
        kind: message.kind,
        ...invalid,
      }) as unknown as JapaneseWorkerResponse,
    });
    await rejection;
    assert.ok(worker.terminated);
    await complete(japaneseMorphology(text));
  }
});

test('background batches bound item/character counts, preserve section IDs and reuse duplicate text', async () => {
  const items = Array.from({ length: 19 }, (_, index) => ({
    id: `section-${index}`,
    text: `一括${index}`,
  }));
  items.push({ id: 'duplicate', text: items[0].text });
  const worker = currentWorker();
  const before = worker.messages.length;
  const results = await complete(analyzeJapaneseBatch(items));
  assert.deepEqual(
    results.map((result) => result.id),
    items.map((item) => item.id),
  );
  assert.deepEqual(
    results.map((result) => result.tokens),
    items.map((item) => tokens(item.text)),
  );
  const messages = worker.messages.slice(before);
  assert.equal(messages.length, 3);
  for (const request of messages) {
    assert.equal(request.kind, 'morphology-batch');
    if (request.kind !== 'morphology-batch') continue;
    assert.ok(request.items.length <= JAPANESE_BATCH_MAX_ITEMS);
    assert.ok(
      request.items.reduce((sum, item) => sum + item.text.length, 0) <=
        JAPANESE_BATCH_MAX_CHARACTERS,
    );
  }
  assert.equal(results[0].tokens, results.at(-1)!.tokens);
});

test('character budgets split long sections without splitting or joining their source text', async () => {
  const items = [
    { id: 'long-a', text: '甲'.repeat(2500) },
    { id: 'long-b', text: '乙'.repeat(2500) },
    { id: 'oversize', text: '丙'.repeat(5000) },
    { id: 'short', text: '丁' },
  ];
  const worker = currentWorker();
  const before = worker.messages.length;
  await complete(analyzeJapaneseBatch(items));
  const sent = worker.messages.slice(before);
  assert.equal(sent.length, 4);
  assert.deepEqual(
    sent.map((request) => ('text' in request ? request.text : null)),
    items.map((item) => item.text),
  );
});

test('interactive work takes priority after the active background batch', async () => {
  const background = Array.from({ length: 16 }, (_, index) =>
    analyzeJapanese(`優先背景${index}`, { priority: 'background' }),
  );
  await tick();
  const worker = currentWorker();
  const interactive = japaneseMorphology('優先選択');
  const first = worker.messages.at(-1)!;
  assert.equal(first.kind, 'morphology-batch');
  worker.replyNext();
  await tick();
  const next = worker.messages.at(-1)!;
  assert.ok('text' in next && next.text === '優先選択');
  worker.replyNext();
  await interactive;
  await complete(Promise.all(background));
});

test('cancellation removes queued work while another consumer of shared analysis survives', async () => {
  const blocker = japaneseMorphology('取消中の実行');
  await tick();
  const controller = new AbortController();
  const cancelledOnly = analyzeJapanese('取消対象', {
    signal: controller.signal,
    priority: 'background',
  });
  const shared = analyzeJapanese('共有対象', {
    signal: controller.signal,
    priority: 'background',
  });
  const retained = japaneseMorphology('共有対象');
  const rejected = Promise.all([
    assert.rejects(cancelledOnly, /cancelled/),
    assert.rejects(shared, /cancelled/),
  ]);
  controller.abort();
  await rejected;
  const worker = currentWorker();
  const before = worker.messages.length;
  worker.replyNext();
  await blocker;
  await complete(retained);
  const sent = worker.messages.slice(before);
  assert.equal(sent.length, 1);
  assert.ok('text' in sent[0] && sent[0].text === '共有対象');
  await complete(japaneseMorphology('取消対象'));
});

test('cancelled transcript analysis never submits later windows or returns stale results', async () => {
  const controller = new AbortController();
  const request = analyzeJapaneseBatch(
    Array.from({ length: 20 }, (_, index) => ({ id: `${index}`, text: `古い話${index}` })),
    { signal: controller.signal },
  );
  const rejection = assert.rejects(request, /cancelled/);
  await tick();
  const worker = currentWorker();
  const count = worker.messages.length;
  controller.abort();
  await rejection;
  worker.replyNext();
  await tick();
  assert.equal(worker.messages.length, count);
  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  await assert.rejects(analyzeJapaneseBatch([], { signal: alreadyAborted.signal }), /cancelled/);
});

test('the analysis cache also limits source size and evicts completed oversized working sets', async () => {
  const one = '大'.repeat(130000);
  const two = '小'.repeat(130000);
  await complete(analyzeJapanese(one));
  await complete(analyzeJapanese(two));
  const worker = currentWorker();
  const before = worker.messages.length;
  await complete(analyzeJapanese(one));
  assert.equal(worker.messages.length, before + 1);
});

test('a cancelled lesson consumer cannot poison a concurrent lesson cache or shared tokens', async () => {
  const lesson = {
    ...demo,
    segments: Array.from({ length: 16 }, (_, index) => ({
      ...demo.segments[0],
      id: `race-${index}`,
      japanese: `授業競合${index}`,
    })),
  } as Lesson;
  const controller = new AbortController();
  const cancelledConsumer = lessonTokens(lesson, controller.signal);
  const retainedConsumer = lessonTokens(lesson);
  const rejection = assert.rejects(cancelledConsumer, /cancelled/);
  await tick();
  controller.abort();
  await rejection;
  const result = await complete(retainedConsumer);
  assert.equal(Object.keys(result).length, 16);
  assert.equal(lessonTokens(lesson), retainedConsumer);
  assert.deepEqual(result['race-15'], tokens('授業競合15'));
});

test('topic overview preserves ranking and its input/cancellation errors through batched analysis', async () => {
  const lesson = {
    ...demo,
    segments: ['発酵', '酵素', '発酵', '温度', '酵素', '発酵'].map((japanese, index) => ({
      ...demo.segments[0],
      id: `topic-${index}`,
      japanese,
    })),
  } as Lesson;
  assert.deepEqual(
    await complete(analyzeTopicVocabulary(lesson)),
    rankTopicVocabulary(
      lesson.segments,
      lesson.segments.map((segment) => tokens(segment.japanese)),
    ),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    analyzeTopicVocabulary(lesson, controller.signal),
    /Topic vocabulary.*cancelled/,
  );
  await assert.rejects(
    analyzeTopicVocabulary({
      ...lesson,
      segments: [{ ...lesson.segments[0], japanese: '甲'.repeat(120001) }],
    }),
    /too large/,
  );
});
