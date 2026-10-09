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

test('media audio windows retain track offset, overlap by four seconds and stay below upload bounds', () => {
  const windows = audioChunkWindows(3.5, 365);
  assert.deepEqual(windows, [
    { index: 0, start: 3.5, end: 119.5 },
    { index: 1, start: 115.5, end: 235.5 },
    { index: 2, start: 231.5, end: 351.5 },
    { index: 3, start: 347.5, end: 365 },
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

test('overlapping chunks keep the complete version of an utterance cut at a boundary', () => {
  const plain = (cues: ReturnType<typeof mergeChunkCues>) =>
    cues.map(({ start, end, text }) => ({ start, end, text }));
  // The first chunk ends at 120 mid-utterance; the second started at 116 and heard it whole. Its
  // opening fragment is the end of a sentence the first chunk heard across 116.
  const merged = mergeChunkCues([
    { start: 0, end: 120, cues: [cue(110, 116.3, '前の文でした。'), cue(117, 120, '途中で')] },
    {
      start: 116,
      end: 236,
      cues: [cue(116.05, 116.4, 'た。'), cue(117.02, 121.5, '途中で切れた文。'), cue(123, 125)],
    },
  ]);
  assert.deepEqual(plain(merged), [
    cue(110, 116.3, '前の文でした。'),
    cue(117.02, 121.5, '途中で切れた文。'),
    cue(123, 125),
  ]);
  // Same-chunk overlapping cues and genuine repetitions after the overlap survive.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 120, cues: [cue(100, 101), cue(100.1, 101.1)] },
        { start: 116, end: 236, cues: [cue(122, 123), cue(124, 125)] },
      ]),
    ),
    [cue(100, 101), cue(100.1, 101.1), cue(122, 123), cue(124, 125)],
  );
  // A cue that began before the next chunk's start cannot be replaced, so it is kept.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 120, cues: [cue(110, 120, '長い文。')] },
        { start: 116, end: 236, cues: [cue(121, 122)] },
      ]),
    ),
    [cue(110, 120, '長い文。'), cue(121, 122)],
  );
  assert.throws(() => mergeChunkCues([]), /No timestamped/);
});

test('an utterance starting exactly at the overlap is kept once, from the fuller hearing', () => {
  const plain = (cues: ReturnType<typeof mergeChunkCues>) =>
    cues.map(({ start, end, text }) => ({ start, end, text }));
  // Windows [0,116] and [112,232]: the first cuts the sentence, the second hears all of it.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 116, cues: [cue(112, 116, 'こんにちは')] },
        { start: 112, end: 232, cues: [cue(112.02, 118, 'こんにちは、世界。')] },
      ]),
    ),
    [cue(112.02, 118, 'こんにちは、世界。')],
  );
});

test('overlap merging splices continuations and never drops speech only one chunk heard', () => {
  const plain = (cues: ReturnType<typeof mergeChunkCues>) =>
    cues.map(({ start, end, text }) => ({ start, end, text }));
  // Whisper grouped the seam differently: the shared words are kept once with both ends.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 116, cues: [cue(110, 116, '今日はいい天気')] },
        { start: 112, end: 232, cues: [cue(113, 120, 'いい天気ですね。')] },
      ]),
    ),
    [cue(110, 120, '今日はいい天気ですね。')],
  );
  // Different words inside the overlap are different speech: both stay.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 116, cues: [cue(113, 114, 'はい。')] },
        { start: 112, end: 232, cues: [cue(114.5, 115.5, 'そうです。')] },
      ]),
    ),
    [cue(113, 114, 'はい。'), cue(114.5, 115.5, 'そうです。')],
  );
  // The same words timed slightly differently, with different punctuation, are kept once.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 116, cues: [cue(113, 114.5, 'はい、そうです。')] },
        { start: 112, end: 232, cues: [cue(113.1, 114.6, 'はい そうです')] },
      ]),
    ),
    [cue(113, 114.5, 'はい、そうです。')],
  );
  // A later chunk's partial hearing of an earlier, complete sentence is dropped.
  assert.deepEqual(
    plain(
      mergeChunkCues([
        { start: 0, end: 116, cues: [cue(112.5, 114, '駅まで歩きます。')] },
        { start: 112, end: 232, cues: [cue(113, 114, '歩きます。')] },
      ]),
    ),
    [cue(112.5, 114, '駅まで歩きます。')],
  );
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
