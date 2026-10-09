import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import ffmpegPath from 'ffmpeg-static';
import { mockProAccount } from '../helpers/pro-account';

async function chooseGeneration(page: Page, file: string) {
  await page.getByRole('button', { name: 'Import media or subtitles' }).click();
  await page.getByRole('button', { name: 'Own media', exact: true }).click();
  await page.getByLabel('Audio or video file', { exact: true }).setInputFiles(file);
  await page.getByRole('button', { name: 'Auto-generate subtitles', exact: true }).click();
}

function wave(seconds: number, speechStart = 0) {
  const data = Buffer.alloc(44 + seconds * 16000 * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(data.length - 8, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24);
  data.writeUInt32LE(32000, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(data.length - 44, 40);
  for (let sample = speechStart * 16000; sample < seconds * 16000; sample++)
    data.writeInt16LE(
      Math.round(5000 * Math.sin((sample * 2 * Math.PI * 400) / 16000)),
      44 + sample * 2,
    );
  return data;
}

function assertAudio(data: Buffer | null, headers: Record<string, string>) {
  expect(headers['content-type']).toContain('audio/wav');
  expect(headers['x-hibiki-audio-chunk']).toBe('1');
  expect(data?.subarray(0, 4).toString()).toBe('RIFF');
  expect(data?.subarray(8, 12).toString()).toBe('WAVE');
  expect(data?.readUInt16LE(22)).toBe(1);
  expect(data?.readUInt32LE(24)).toBe(16000);
  expect(data?.readUInt16LE(34)).toBe(16);
  expect(data?.byteLength).toBeLessThan(4 * 1024 * 1024);
}

function assertCopiedAudio(data: Buffer | null, headers: Record<string, string>) {
  expect(headers['content-type']).toBe('audio/mp4');
  expect(headers['x-hibiki-audio-chunk']).toBeUndefined();
  expect(data).not.toBeNull();
  const handlers: string[] = [];
  const scan = (start: number, end: number) => {
    for (let at = start; at + 8 <= end;) {
      const size = data!.readUInt32BE(at);
      const type = data!.toString('ascii', at + 4, at + 8);
      expect(size).toBeGreaterThanOrEqual(8);
      expect(at + size).toBeLessThanOrEqual(end);
      if (type === 'hdlr') handlers.push(data!.toString('ascii', at + 16, at + 20));
      if (['moov', 'trak', 'mdia'].includes(type)) scan(at + 8, at + size);
      at += size;
    }
  };
  scan(0, data!.length);
  expect(handlers).toEqual(['soun']);
  expect(data!.byteLength).toBeLessThan(9 * 1024 * 1024);
}

// A real MP4 with a sparse, valid free box exercises large File reads without an expensive test video.
test('large local MP4 extracts only bounded audio and retains original native video playback', async ({
  page,
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-large-media-'));
  const fixture = path.join(directory, 'large-japanese.mp4');
  try {
    fs.copyFileSync('public/demo.mp4', fixture);
    const current = fs.statSync(fixture).size;
    const target = 300 * 1024 * 1024;
    const descriptor = fs.openSync(fixture, 'r+');
    try {
      const free = Buffer.alloc(8);
      free.writeUInt32BE(target - current, 0);
      free.write('free', 4);
      fs.writeSync(descriptor, free, 0, 8, current);
      fs.ftruncateSync(descriptor, target);
    } finally {
      fs.closeSync(descriptor);
    }
    expect(fs.statSync(fixture).size).toBeGreaterThan(250 * 1024 * 1024);
    await mockProAccount(page);
    let uploads = 0;
    let workerLoads = 0;
    page.on('request', (request) => {
      if (request.url().endsWith('/media-audio-worker.js')) workerLoads++;
    });
    await page.route('**/api/transcribe', async (route) => {
      uploads++;
      assertCopiedAudio(route.request().postDataBuffer(), route.request().headers());
      await route.fulfill({
        json: {
          cues: [{ start: 0.5, end: 3, text: '日本語を練習します。' }],
          provider: 'fixture Whisper',
        },
      });
    });
    await page.goto('/');
    expect(workerLoads).toBe(0);
    await chooseGeneration(page, fixture);
    expect(uploads).toBe(0);
    expect(workerLoads).toBe(0);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'large-japanese', exact: true })).toBeVisible();
    await expect(page.locator('video')).toHaveAttribute('src', /^blob:/);
    const duration = await page
      .locator('video')
      .evaluate((video: HTMLVideoElement) => video.duration);
    expect(duration).toBeGreaterThan(70);
    expect(uploads).toBe(1);
    expect(workerLoads).toBe(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('cancelled chunk queue resumes only complete audio chunks after refresh and reattachment', async ({
  page,
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-resume-media-'));
  const fixture = path.join(directory, 'long-japanese.wav');
  fs.writeFileSync(fixture, wave(132));
  let calls = 0;
  let release: (() => void) | undefined;
  try {
    await mockProAccount(page);
    await page.route('**/api/transcribe', async (route) => {
      calls++;
      assertAudio(route.request().postDataBuffer(), route.request().headers());
      if (calls === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route
        .fulfill({
          json: {
            cues: [{ start: 1, end: 3, text: calls === 1 ? '最初の言葉です。' : '次の言葉です。' }],
            provider: 'fixture Whisper',
          },
        })
        .catch(() => {});
    });
    await page.goto('/');
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect.poll(() => calls).toBe(2);
    await page.getByRole('button', { name: 'Cancel preparation' }).click();
    release?.();
    await expect(
      page.getByRole('button', { name: 'Generate subtitles & start', exact: true }),
    ).toBeEnabled();
    await page.reload();
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'long-japanese', exact: true })).toBeVisible();
    expect(calls).toBe(3);
    const cues = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) =>
        key.startsWith('hibiki:v1:lesson:upload-'),
      );
      return key ? JSON.parse(localStorage.getItem(key)!).segments : [];
    });
    expect(cues.some((cue: { start: number }) => cue.start >= 112)).toBe(true);
  } finally {
    release?.();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('silent audio chunk does not abort later speech and keeps original timestamps', async ({
  page,
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-silent-media-'));
  const fixture = path.join(directory, 'silence-then-japanese.wav');
  fs.writeFileSync(fixture, wave(132, 113));
  let calls = 0;
  try {
    await mockProAccount(page);
    await page.route('**/api/transcribe', async (route) => {
      calls++;
      assertAudio(route.request().postDataBuffer(), route.request().headers());
      if (calls === 1)
        await route.fulfill({
          status: 503,
          json: { error: 'No Japanese speech was detected in this media.' },
        });
      else
        await route.fulfill({
          json: {
            cues: [{ start: 1, end: 4, text: '日本語の言葉です。' }],
            provider: 'fixture Whisper',
          },
        });
    });
    await page.goto('/');
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'silence-then-japanese', exact: true }),
    ).toBeVisible();
    expect(calls).toBe(2);
    const start = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) =>
        key.startsWith('hibiki:v1:lesson:upload-'),
      );
      return key ? JSON.parse(localStorage.getItem(key)!).segments[0].start : -1;
    });
    expect(start).toBe(113);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AAC stream copy resumes beyond two minutes without WebCodecs and uploads no video track', async ({
  page,
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-aac-media-'));
  const fixture = path.join(directory, 'long-aac.m4a');
  if (!ffmpegPath) throw new Error('The pinned ffmpeg fixture generator is unavailable.');
  execFileSync(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=400:sample_rate=48000',
    '-t',
    '132',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    fixture,
  ]);
  let calls = 0;
  let release: (() => void) | undefined;
  try {
    await mockProAccount(page);
    await page.route('**/furigana/v1/media-audio-worker.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: 'self.AudioDecoder=undefined;\n' + (await response.text()),
      });
    });
    await page.route('**/api/transcribe', async (route) => {
      calls++;
      assertCopiedAudio(route.request().postDataBuffer(), route.request().headers());
      if (calls === 2)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      await route
        .fulfill({
          json: {
            cues: [{ start: 1, end: 3, text: calls === 1 ? '最初です。' : '次です。' }],
            provider: 'fixture Whisper',
          },
        })
        .catch(() => {});
    });
    await page.goto('/');
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect.poll(() => calls).toBe(2);
    await page.getByRole('button', { name: 'Cancel preparation' }).click();
    release?.();
    await page.reload();
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'long-aac', exact: true })).toBeVisible();
    expect(calls).toBe(3);
    const starts: number[] = await page.evaluate(() => {
      const key = Object.keys(localStorage).find((key) =>
        key.startsWith('hibiki:v1:lesson:upload-'),
      );
      return key
        ? JSON.parse(localStorage.getItem(key)!).segments.map((cue: { start: number }) => cue.start)
        : [];
    });
    expect(starts[0]).toBeCloseTo(1, 2);
    expect(starts[1]).toBeCloseTo(113, 1);
  } finally {
    release?.();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('AAC final packet covers a tiny trailing window without an empty or repeated upload', async ({
  page,
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-aac-boundary-'));
  const fixture = path.join(directory, 'packet-boundary.m4a');
  if (!ffmpegPath) throw new Error('The pinned ffmpeg fixture generator is unavailable.');
  execFileSync(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=400:sample_rate=44100',
    '-t',
    '116.0003',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    fixture,
  ]);
  let calls = 0;
  try {
    await mockProAccount(page);
    await page.route('**/api/transcribe', async (route) => {
      calls++;
      assertCopiedAudio(route.request().postDataBuffer(), route.request().headers());
      await route.fulfill({
        json: { cues: [{ start: 1, end: 3, text: '日本語です。' }], provider: 'fixture Whisper' },
      });
    });
    await page.goto('/');
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'packet-boundary', exact: true })).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('short MP3 uses bounded browser audio fallback when WebCodecs audio decoding is unavailable', async ({
  page,
}) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-short-media-'));
  const fixture = path.join(directory, 'short-mp3.mp3');
  if (!ffmpegPath) throw new Error('The pinned ffmpeg fixture generator is unavailable.');
  execFileSync(ffmpegPath, [
    '-nostdin',
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=400:sample_rate=48000',
    '-t',
    '8',
    '-c:a',
    'libmp3lame',
    fixture,
  ]);
  let calls = 0;
  try {
    await mockProAccount(page);
    await page.route('**/furigana/v1/media-audio-worker.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body: 'self.AudioDecoder=undefined;\n' + (await response.text()),
      });
    });
    await page.route('**/api/transcribe', async (route) => {
      calls++;
      assertAudio(route.request().postDataBuffer(), route.request().headers());
      await route.fulfill({
        json: { cues: [{ start: 1, end: 3, text: '日本語です。' }], provider: 'fixture Whisper' },
      });
    });
    await page.goto('/');
    await chooseGeneration(page, fixture);
    await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'short-mp3', exact: true })).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
