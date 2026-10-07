import assert from 'node:assert/strict';
import { test } from 'node:test';
import { recordingAudioDiagnostics } from '../src/lib/audio-diagnostics-client';
import { analyzeAudioDiagnostics } from '../src/lib/audio-diagnostics';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function browser(
  options: {
    delayedDecode?: Promise<AudioBuffer>;
    holdWorker?: boolean;
    failWorker?: boolean;
  } = {},
) {
  const descriptors = new Map(
    ['OfflineAudioContext', 'Worker'].map((name) => [
      name,
      Object.getOwnPropertyDescriptor(globalThis, name),
    ]),
  );
  const constructed = deferred<StubWorker>();
  const decoding = deferred<void>();
  const workers: StubWorker[] = [];
  let decodeCalls = 0;
  class StubContext {
    constructor(channels: number, length: number, sampleRate: number) {
      assert.equal(channels, 1);
      assert.equal(length, 1);
      assert.equal(sampleRate, 16000);
    }
    async decodeAudioData() {
      decodeCalls++;
      decoding.resolve();
      return options.delayedDecode ?? decoded();
    }
  }
  class StubWorker {
    terminated = false;
    onmessage?: (event: { data: unknown }) => void;
    onerror?: () => void;
    constructor(url: string) {
      assert.equal(url, '/furigana/v1/audio-diagnostics-worker.js');
      workers.push(this);
      constructed.resolve(this);
    }
    postMessage(data: { channels: Float32Array[]; sampleRate: number }, transfer: ArrayBuffer[]) {
      assert.equal(data.channels.length, transfer.length);
      for (let index = 0; index < data.channels.length; index++)
        assert.equal(transfer[index], data.channels[index].buffer);
      if (options.holdWorker) return;
      queueMicrotask(() => {
        if (options.failWorker) this.onerror?.();
        else
          this.onmessage?.({
            data: { result: analyzeAudioDiagnostics(data.channels, data.sampleRate) },
          });
      });
    }
    terminate() {
      this.terminated = true;
    }
  }
  Object.defineProperty(globalThis, 'OfflineAudioContext', {
    value: StubContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Worker', { value: StubWorker, configurable: true });
  return {
    workers,
    constructed: constructed.promise,
    decoding: decoding.promise,
    decodeCalls: () => decodeCalls,
    restore() {
      for (const [name, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

function decoded(): AudioBuffer {
  const samples = new Float32Array(16000);
  return {
    length: 16000,
    duration: 1,
    numberOfChannels: 1,
    sampleRate: 16000,
    getChannelData: () => samples,
    copyFromChannel: (destination, _channel, start = 0) =>
      destination.set(samples.subarray(start, start + destination.length)),
    copyToChannel: (source, _channel, start = 0) => samples.set(source, start),
  };
}
const recording = () => new Blob([new Uint8Array(128)], { type: 'audio/webm' });

test('local recording decoding transfers bounded PCM and terminates its worker after success', async () => {
  const state = browser();
  try {
    const result = await recordingAudioDiagnostics(recording(), 1, new AbortController().signal);
    assert.equal(result.activity, 'none');
    assert.equal(state.decodeCalls(), 1);
    assert.equal(state.workers.length, 1);
    assert.equal(state.workers[0].terminated, true);
  } finally {
    state.restore();
  }
});

test('elapsed recording and encoded bounds reject before native decoding', async () => {
  const state = browser();
  try {
    for (const duration of [0, NaN, Infinity, 62])
      await assert.rejects(
        recordingAudioDiagnostics(recording(), duration, new AbortController().signal),
        /up to one minute/,
      );
    await assert.rejects(
      recordingAudioDiagnostics(recording(), 60, new AbortController().signal, 0.5),
      /up to one minute/,
    );
    await assert.rejects(
      recordingAudioDiagnostics(
        new Blob([new Uint8Array(8 * 1024 * 1024 + 1)]),
        60,
        new AbortController().signal,
      ),
      /too large/,
    );
    assert.equal(state.decodeCalls(), 0);
    assert.equal(state.workers.length, 0);
  } finally {
    state.restore();
  }
});

test('reference activity uses selected playback time without changing the decoded samples', async () => {
  const state = browser();
  try {
    const slow = await recordingAudioDiagnostics(recording(), 1, new AbortController().signal, 0.5);
    const fast = await recordingAudioDiagnostics(
      recording(),
      1,
      new AbortController().signal,
      1.25,
    );
    assert.equal(slow.durationSeconds, 2);
    assert.equal(fast.durationSeconds, 0.8);
    assert.equal(state.workers.length, 2);
    assert.ok(state.workers.every((worker) => worker.terminated));
  } finally {
    state.restore();
  }
});

test('cancellation during native decoding prevents a stale worker from being created', async () => {
  const native = deferred<AudioBuffer>();
  const state = browser({ delayedDecode: native.promise });
  const controller = new AbortController();
  try {
    const result = recordingAudioDiagnostics(recording(), 1, controller.signal);
    await state.decoding;
    controller.abort();
    native.resolve(decoded());
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(state.workers.length, 0);
  } finally {
    state.restore();
  }
});

test('cancellation terminates in-flight numeric work without exposing results', async () => {
  const state = browser({ holdWorker: true });
  const controller = new AbortController();
  try {
    const result = recordingAudioDiagnostics(recording(), 1, controller.signal);
    const worker = await state.constructed;
    controller.abort();
    await assert.rejects(result, { name: 'AbortError' });
    assert.equal(worker.terminated, true);
  } finally {
    state.restore();
  }
});

test('worker failure is recoverable and does not retain the old worker', async () => {
  const state = browser({ failWorker: true });
  try {
    await assert.rejects(
      recordingAudioDiagnostics(recording(), 1, new AbortController().signal),
      /failed/,
    );
    assert.equal(state.workers[0].terminated, true);
  } finally {
    state.restore();
  }
});

test('unsupported browsers leave listening back available and do not start another service', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'OfflineAudioContext');
  Object.defineProperty(globalThis, 'OfflineAudioContext', {
    value: undefined,
    configurable: true,
  });
  try {
    await assert.rejects(
      recordingAudioDiagnostics(recording(), 1, new AbortController().signal),
      /unavailable.*listen back/,
    );
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'OfflineAudioContext', descriptor);
    else Reflect.deleteProperty(globalThis, 'OfflineAudioContext');
  }
});
