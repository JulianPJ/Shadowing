import { test } from 'node:test';
import assert from 'node:assert/strict';
import { japaneseReadings } from '../src/lib/furigana-client';
import type { JapaneseReadingToken } from '../src/lib/japanese-readings';

class FakeWorker {
  static instances: FakeWorker[] = [];
  messages: { id: number; text: string }[] = [];
  onmessage?: (event: { data: { id: number; tokens: JapaneseReadingToken[]; error?: boolean } }) => void;
  onerror?: () => void;
  terminated = false;
  constructor(readonly url: string) { FakeWorker.instances.push(this); }
  postMessage(message: { id: number; text: string }) { this.messages.push(message); }
  terminate() { this.terminated = true; }
  reply(index: number) { const request = this.messages[index]; this.onmessage?.({ data: { id: request.id, tokens: [{ text: request.text, reading: 'にほんご' }] } }); }
}
Object.defineProperty(globalThis, 'Worker', { configurable: true, value: FakeWorker });
test('reading cache is lazy, deduplicates in-flight/cached canonical text and recovers worker failures', async () => {
  assert.deepEqual(await japaneseReadings('こんにちは。'), [{ text: 'こんにちは。' }]);
  assert.equal(FakeWorker.instances.length, 0);
  const first = japaneseReadings('日本語'), repeated = japaneseReadings('日本語');
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
