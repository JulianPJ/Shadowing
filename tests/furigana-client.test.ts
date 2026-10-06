import { test } from 'node:test';
import assert from 'node:assert/strict';
import { japaneseMorphology, japaneseReadings } from '../src/lib/furigana-client';
import type { JapaneseReadingToken, MorphologicalToken } from '../src/lib/japanese-readings';

type FakeMessage = { id: number; text: string; kind?: 'readings' | 'morphology' };
type FakeResponse = {
  id: number;
  kind?: 'readings' | 'morphology';
  tokens: JapaneseReadingToken[] | MorphologicalToken[];
  error?: boolean;
};

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: FakeMessage[] = [];
  onmessage?: (event: { data: FakeResponse }) => void;
  onerror?: () => void;
  terminated = false;
  constructor(readonly url: string) {
    FakeWorker.instances.push(this);
  }
  postMessage(message: FakeMessage) {
    this.messages.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  reply(index: number) {
    const request = this.messages[index];
    // Deliberately omit kind to cover compatibility with the original readings-only worker.
    this.onmessage?.({
      data: { id: request.id, tokens: [{ text: request.text, reading: 'にほんご' }] },
    });
  }
  replyMorphology(index: number) {
    const request = this.messages[index];
    this.onmessage?.({
      data: {
        id: request.id,
        kind: 'morphology',
        tokens: [
          {
            surface_form: request.text,
            basic_form: request.text,
            reading: 'キンリ',
            word_type: 'KNOWN',
            pos: '名詞',
            pos_detail_1: '一般',
          },
        ],
      },
    });
  }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });

test('reading cache is lazy, deduplicates in-flight/cached canonical text and recovers worker failures', async () => {
  assert.deepEqual(await japaneseReadings('こんにちは。'), [{ text: 'こんにちは。' }]);
  assert.equal(FakeWorker.instances.length, 0);
  const first = japaneseReadings('日本語'),
    repeated = japaneseReadings('日本語');
  assert.equal(first, repeated);
  const worker = FakeWorker.instances[0];
  assert.equal(worker.url, '/furigana/v1/worker.js');
  assert.equal(worker.messages.length, 1);
  worker.reply(0);
  assert.deepEqual(await first, [{ text: '日本語', reading: 'にほんご' }]);
  assert.equal(japaneseReadings('日本語'), first);
  const failed = japaneseReadings('天気');
  worker.onerror?.();
  await assert.rejects(failed, /unavailable/);
  assert.ok(worker.terminated);
  const retry = japaneseReadings('天気');
  assert.equal(FakeWorker.instances.length, 2);
  FakeWorker.instances[1].reply(0);
  await retry;
});

test('morphology reuses the optional worker and keeps its cache separate from readings', async () => {
  const morphology = japaneseMorphology('金利');
  const worker = FakeWorker.instances.at(-1)!;
  const requestIndex = worker.messages.length - 1;
  assert.equal(worker.messages[requestIndex].kind, 'morphology');
  worker.replyMorphology(requestIndex);
  assert.deepEqual(await morphology, [
    {
      surface_form: '金利',
      basic_form: '金利',
      reading: 'キンリ',
      word_type: 'KNOWN',
      pos: '名詞',
      pos_detail_1: '一般',
    },
  ]);
  assert.equal(japaneseMorphology('金利'), morphology);
});
