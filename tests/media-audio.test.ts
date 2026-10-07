import { test } from 'node:test';
import assert from 'node:assert/strict';
import { audioChunkWindows, AUDIO_SAMPLE_RATE } from '../src/lib/media-audio/types';
import { allocateWave } from '../src/lib/media-audio/wav';
import { mapChunkCues, mergeChunkCues } from '../src/lib/media-audio/cues';
import {
  audioDigest,
  mediaFingerprint,
  TranscriptionCheckpoints,
} from '../src/lib/media-audio/checkpoint';
import { SpeechLowPass } from '../src/lib/media-audio/low-pass';
import { canonicalizeAudioMp4 } from '../src/lib/media-audio/mp4';

const cue = (start: number, end: number, text = 'はい。') => ({ start, end, text });

test('media audio windows retain track offset and remain far below upload body bounds', () => {
  const windows = audioChunkWindows(3.5, 365);
  assert.deepEqual(windows, [
    { index: 0, start: 3.5, end: 123.5 },
    { index: 1, start: 123.5, end: 243.5 },
    { index: 2, start: 243.5, end: 363.5 },
    { index: 3, start: 363.5, end: 365 },
  ]);
  for (const window of windows)
    assert.ok(allocateWave(window.end - window.start).buffer.byteLength < 4 * 1024 * 1024);
  assert.throws(() => audioChunkWindows(0, 14401), /four hours/);
  assert.throws(() => audioChunkWindows(0, Infinity), /finite/);
});

test('prepared audio is mono16k16bit WAV with silent timeline gaps by default', () => {
  const { buffer, pcm } = allocateWave(2);
  const view = new DataView(buffer);
  assert.equal(new TextDecoder().decode(buffer.slice(0, 4)), 'RIFF');
  assert.equal(new TextDecoder().decode(buffer.slice(8, 12)), 'WAVE');
  assert.equal(view.getUint16(22, true), 1);
  assert.equal(view.getUint32(24, true), AUDIO_SAMPLE_RATE);
  assert.equal(view.getUint16(34, true), 16);
  assert.equal(view.getUint32(40, true), 64000);
  assert.equal(pcm.length, 32000);
  assert.ok(pcm.every((sample) => sample === 0));
  assert.throws(() => allocateWave(123), /bounded/);
});

test('chunk cues restore original timestamps and reject out-of-range provider timings', () => {
  const mapped = mapChunkCues([cue(1, 3, '日本語です。')], 118, 240);
  assert.deepEqual(
    mapped.map(({ start, end, text }) => ({ start, end, text })),
    [cue(119, 121, '日本語です。')],
  );
  assert.throws(() => mapChunkCues([cue(0, 126)], 118, 240), /outside/);
  assert.throws(() => mapChunkCues([cue(122, 123)], 118, 240), /outside/);
});

test('overlap reconciliation preserves actual repetitions and same-chunk overlapping cues', () => {
  const merged = mergeChunkCues([
    [cue(119, 120), cue(119.1, 120.1)],
    [cue(119, 120), cue(120.5, 121.5), cue(122, 123, 'はいはい。')],
  ]);
  assert.deepEqual(
    merged.map(({ start, end, text }) => ({ start, end, text })),
    [cue(119, 120), cue(119.1, 120.1), cue(120.5, 121.5), cue(122, 123, 'はいはい。')],
  );
  assert.throws(() => mergeChunkCues([]), /No timestamped/);
});

test('resume checkpoints require exact prepared chunk bytes and timeline, remain account-key isolated', async () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
  const file = new File(['same-prefix', 'different-middle', 'same-suffix'], 'private-file.wav', {
    lastModified: 1,
  });
  const id = await mediaFingerprint(file);
  const digest = await audioDigest(new Uint8Array([1, 2]).buffer);
  const first = new TranscriptionCheckpoints(storage, 'account-one', id);
  first.save(0, { digest, start: 3, end: 5, cues: [cue(3, 4)], provider: 'fixture' });
  assert.equal(
    new TranscriptionCheckpoints(storage, 'account-one', id).load(0, digest, 3, 5)?.provider,
    'fixture',
  );
  assert.equal(first.load(0, await audioDigest(new Uint8Array([1, 3]).buffer), 3, 5), undefined);
  assert.equal(first.load(0, digest, 0, 5), undefined);
  assert.equal(
    new TranscriptionCheckpoints(storage, 'account-two', id).load(0, digest, 3, 5),
    undefined,
  );
  assert.ok(!data.get('account-one')!.includes('private-file.wav'));
  const unavailable = new TranscriptionCheckpoints(
    {
      getItem() {
        throw new Error('blocked');
      },
      setItem() {
        throw new Error('blocked');
      },
    },
    'blocked',
    id,
  );
  assert.doesNotThrow(() =>
    unavailable.save(0, { digest, start: 3, end: 5, cues: [], provider: 'fixture' }),
  );
  assert.deepEqual(unavailable.load(0, digest, 3, 5)?.cues, []);
});

test('streaming antialias filter retains speech frequencies and rejects folding high frequencies', () => {
  const rate = 48000;
  const rms = (frequency: number) => {
    const samples = Float32Array.from({ length: rate }, (_, i) =>
      Math.sin((2 * Math.PI * frequency * i) / rate),
    );
    const filter = new SpeechLowPass(rate);
    const first = filter.process(samples.subarray(0, 1000));
    const rest = filter.process(samples.subarray(1000));
    const together = new Float32Array(rate);
    together.set(first);
    together.set(rest, first.length);
    const reference = new SpeechLowPass(rate).process(samples);
    assert.deepEqual(together, reference);
    return Math.sqrt(rest.reduce((sum, value) => sum + value * value, 0) / rest.length);
  };
  assert.ok(rms(1000) > 0.7);
  assert.ok(rms(12000) < 0.005);
});

test('generated AAC containers have stable dates while audio bytes and timing fields stay exact', () => {
  const box = (type: string, body: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(8 + body.length);
    header.write(type, 4);
    return Buffer.concat([header, body]);
  };
  const output = (date: number) => {
    const header = Buffer.alloc(28, 7);
    header[0] = 0;
    header.writeUInt32BE(date, 4);
    header.writeUInt32BE(date, 8);
    const contents = Buffer.concat([
      box(
        'moov',
        Buffer.concat([
          box('mvhd', header),
          box('trak', Buffer.concat([box('tkhd', header), box('mdia', box('mdhd', header))])),
        ]),
      ),
      box('mdat', Buffer.from([1, 2, 3, 4])),
    ]);
    return contents.buffer.slice(contents.byteOffset, contents.byteOffset + contents.byteLength);
  };
  const first = canonicalizeAudioMp4(output(100));
  const second = canonicalizeAudioMp4(output(200));
  assert.deepEqual(new Uint8Array(first), new Uint8Array(second));
  assert.deepEqual(new Uint8Array(first).slice(-4), new Uint8Array([1, 2, 3, 4]));
  assert.equal(new DataView(first).getUint32(36), 0x07070707);
  assert.throws(() => canonicalizeAudioMp4(new ArrayBuffer(8)), /invalid/);
});
