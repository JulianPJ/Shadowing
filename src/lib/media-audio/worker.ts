import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  WavOutputFormat,
  type InputAudioTrack,
} from 'mediabunny';
import {
  AUDIO_SAMPLE_RATE,
  audioChunkWindows,
  type MediaAudioCommand,
  type MediaAudioResponse,
} from './types';
import { allocateWave } from './wav';
import { SpeechLowPass } from './low-pass';
import { canonicalizeAudioMp4 } from './mp4';

const scope = globalThis as unknown as {
  postMessage: (message: MediaAudioResponse, transfer?: Transferable[]) => void;
  onmessage: ((event: MessageEvent<MediaAudioCommand>) => void) | null;
};
let input: Input | undefined;
let track: InputAudioTrack | undefined;
let windows: ReturnType<typeof audioChunkWindows> = [];
let next = 0;
let running = false;
let copyAudio = false;

async function initialize(file: File, range?: { start: number; end: number }) {
  input?.dispose();
  input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file, { maxCacheSize: 4 * 1024 * 1024 }),
  });
  track = (await input.getPrimaryAudioTrack()) ?? undefined;
  if (!track) throw new Error('This media has no readable audio track. Add subtitles manually.');
  const nativeDecode = await track.canDecode();
  copyAudio = !range && (await track.getCodec()) === 'aac';
  const channels = await track.getNumberOfChannels();
  const rate = await track.getSampleRate();
  if (channels > 8 || rate > 192000)
    throw new Error(
      'This audio track exceeds browser preparation limits. Choose a smaller audio track or add subtitles manually.',
    );
  const start = Math.max(0, await track.getFirstTimestamp());
  const end = await track.computeDuration();
  if (range) {
    if (
      !Number.isFinite(range.start) ||
      !Number.isFinite(range.end) ||
      range.start < 0 ||
      range.end <= range.start ||
      range.end - range.start > 61 ||
      range.start < start ||
      range.end > end + 0.001
    )
      throw new Error(
        'The requested audio excerpt is outside this media or longer than one minute.',
      );
    windows = [{ index: 0, start: range.start, end: Math.min(range.end, end) }];
  } else windows = audioChunkWindows(start, end);
  next = 0;
  scope.postMessage({
    type: 'ready',
    info: {
      start,
      end,
      total: windows.length,
      trackName: await track.getName(),
      language: await track.getLanguageCode(),
      nativeDecode,
      channels,
      sampleRate: rate,
      audioTracks: (await input.getAudioTracks()).length,
      canCopyAudio: copyAudio,
    },
  });
}

async function extract() {
  const window = windows[next];
  if (!window) {
    input?.dispose();
    scope.postMessage({ type: 'done' });
    return;
  }
  if (!track) throw new Error('Choose the media file again to prepare its audio.');
  if (copyAudio) {
    try {
      return await copyAac(window);
    } catch (error) {
      // Unusual AAC timelines or unusually high bitrates still use bounded PCM when native
      // decoding is available. A missing decoder never causes the original video to be sent.
      if (!(await track.canDecode())) throw error;
      copyAudio = false;
    }
  }
  if (!(await track.canDecode())) {
    throw new Error(
      'This browser cannot extract this audio codec. Choose a supported audio track or add subtitles manually.',
    );
  }
  const { buffer, pcm } = allocateWave(window.end - window.start);
  // The library handles browser decoding, channel mixing and resampling. Its PCM output is copied at
  // presentation timestamps into this fixed window, preserving edit-list offsets and missing packets.
  // A discarded streaming mux target avoids retaining a second copy of the prepared audio.
  const source = new AudioSampleSource({
    codec: 'pcm-s16',
    transform: {
      numberOfChannels: 1,
      sampleRate: AUDIO_SAMPLE_RATE,
      sampleFormat: 's16',
      process(sample) {
        const offset = Math.round((sample.timestamp - window.start) * AUDIO_SAMPLE_RATE);
        const frameOffset = Math.max(0, -offset);
        const destination = Math.max(0, offset);
        const frames = Math.min(sample.numberOfFrames - frameOffset, pcm.length - destination);
        if (frames > 0)
          sample.copyTo(pcm.subarray(destination, destination + frames), {
            planeIndex: 0,
            format: 's16',
            frameOffset,
            frameCount: frames,
          });
        return sample;
      },
    },
  });
  const output = new Output({
    format: new WavOutputFormat(),
    target: new StreamTarget(new WritableStream({ write() {} })),
  });
  output.addAudioTrack(source);
  let filter: SpeechLowPass | undefined;
  let previousEnd: number | undefined;
  const add = async (sample: AudioSample) => {
    if (sample.sampleRate <= AUDIO_SAMPLE_RATE) {
      await source.add(sample);
      return;
    }
    if (!filter || filter.sampleRate !== sample.sampleRate)
      filter = new SpeechLowPass(sample.sampleRate);
    if (
      previousEnd !== undefined &&
      Math.abs(sample.timestamp - previousEnd) > 2 / sample.sampleRate
    )
      filter.reset();
    previousEnd = sample.timestamp + sample.duration;
    const channels = sample.numberOfChannels;
    const interleaved = new Float32Array(sample.numberOfFrames * channels);
    sample.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
    const mono = new Float32Array(sample.numberOfFrames);
    for (let i = 0; i < mono.length; i++)
      for (let c = 0; c < channels; c++) mono[i] += interleaved[i * channels + c] / channels;
    const filtered = new AudioSample({
      data: filter.process(mono),
      format: 'f32',
      sampleRate: sample.sampleRate,
      numberOfChannels: 1,
      timestamp: sample.timestamp - filter.delayFrames / sample.sampleRate,
    });
    try {
      await source.add(filtered);
    } finally {
      filtered.close();
    }
  };
  try {
    await output.start();
    const sink = new AudioSampleSink(track);
    for await (const sample of sink.samples(window.start, window.end)) {
      try {
        const first = Math.max(
          0,
          Math.round((window.start - sample.timestamp) * sample.sampleRate),
        );
        const last = Math.min(
          sample.numberOfFrames,
          Math.round((window.end - sample.timestamp) * sample.sampleRate),
        );
        if (last <= first) continue;
        if (first || last < sample.numberOfFrames) {
          const trimmed = sample.trim(first, last);
          try {
            await add(trimmed);
          } finally {
            trimmed.close();
          }
        } else await add(sample);
      } finally {
        sample.close();
      }
    }
    if (filter && previousEnd !== undefined) {
      const tail = new AudioSample({
        data: filter.process(new Float32Array(filter.delayFrames)),
        format: 'f32',
        sampleRate: filter.sampleRate,
        numberOfChannels: 1,
        timestamp: previousEnd - filter.delayFrames / filter.sampleRate,
      });
      try {
        await source.add(tail);
      } finally {
        tail.close();
      }
    }
    source.close();
    await output.finalize();
  } catch (error) {
    await output.cancel();
    throw error;
  }
  next++;
  scope.postMessage({ type: 'chunk', chunk: { ...window, audio: buffer } }, [buffer]);
}

/** Preserve supported AAC bytes and packet timing without requiring a browser audio decoder. */
async function copyAac(window: { index: number; start: number; end: number }) {
  if (!track) throw new Error('Choose the media file again to prepare its audio.');
  const sink = new EncodedPacketSink(track);
  // Windows overlap, so each copy starts from the packet covering its own window start.
  let packet = (await sink.getPacket(window.start)) ?? (await sink.getFirstPacket());
  while (packet && packet.timestamp < 0) packet = await sink.getNextPacket(packet);
  if (!packet) throw new Error('This audio track contains no readable packets.');
  const start = packet.timestamp;
  let end = start;
  let payloadBytes = 0;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });
  const source = new EncodedAudioPacketSource('aac');
  const config = await track.getDecoderConfig();
  if (!config) throw new Error('This audio track has no readable decoder configuration.');
  output.addAudioTrack(source);
  try {
    await output.start();
    while (packet && packet.timestamp < window.end) {
      payloadBytes += packet.data.byteLength;
      if (payloadBytes > 8 * 1024 * 1024 || packet.duration > 1)
        throw new Error(
          'This compressed audio exceeds the bounded preparation limit. Choose a smaller audio track or add subtitles manually.',
        );
      if (end > start && Math.abs(packet.timestamp - end) > 0.001)
        throw new Error(
          'This compressed audio has timeline gaps. Choose an extracted audio track or add subtitles manually.',
        );
      await source.add(packet.clone({ timestamp: packet.timestamp - start }), {
        decoderConfig: config,
      });
      end = packet.timestamp + packet.duration;
      packet = await sink.getNextPacket(packet);
    }
    source.close();
    await output.finalize();
    if (!target.buffer || target.buffer.byteLength > 9 * 1024 * 1024 || end - start > 122)
      throw new Error(
        'This audio track exceeds the bounded preparation limit. Add subtitles manually.',
      );
    canonicalizeAudioMp4(target.buffer);
    next++;
    scope.postMessage(
      {
        type: 'chunk',
        chunk: { index: window.index, start, end, audio: target.buffer, mimeType: 'audio/mp4' },
      },
      [target.buffer],
    );
  } catch (error) {
    await output.cancel();
    throw error;
  }
}

scope.onmessage = (event) => {
  if (running) return;
  running = true;
  void (event.data.type === 'init' ? initialize(event.data.file, event.data.range) : extract())
    .catch((error: unknown) => {
      input?.dispose();
      scope.postMessage({
        type: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Audio preparation failed. Add subtitles manually.',
      });
    })
    .finally(() => {
      running = false;
    });
};
