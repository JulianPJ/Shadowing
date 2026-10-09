import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockProAccount } from '../helpers/pro-account';

// Hibiki Bridge: Hibiki plays and subtitles a video on another site through the extension.
// The extension APIs these tests call inside its service worker.
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  tabs: { query(filter: Record<string, unknown>): Promise<{ id?: number; url?: string }[]> };
};
const hibiki = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001').origin;
const fixturePage = (track: boolean) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>朝の散歩 · Fixture</title></head>
<body><video controls width="640" height="360" src="/demo.mp4" crossorigin="anonymous">${
  track ? '<track kind="subtitles" srclang="ja" label="日本語" src="/demo.vtt">' : ''
}</video></body></html>`;

/** A stand-in third-party site on another origin, with range requests so its video can seek. */
function startSite() {
  const files: Record<string, [string, string]> = {
    '/demo.mp4': [path.resolve('public/demo.mp4'), 'video/mp4'],
    '/demo.vtt': [path.resolve('public/demo.vtt'), 'text/vtt'],
  };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/video.html' || url.pathname === '/plain.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fixturePage(url.pathname === '/video.html'));
      return;
    }
    const file = files[url.pathname];
    if (!file) {
      response.writeHead(404).end();
      return;
    }
    const size = fs.statSync(file[0]).size;
    const range = /bytes=(\d+)-(\d*)/.exec(request.headers.range ?? '');
    const start = range ? Number(range[1]) : 0,
      end = range && range[2] ? Number(range[2]) : size - 1;
    response.writeHead(range ? 206 : 200, {
      'Content-Type': file[1],
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
    });
    fs.createReadStream(file[0], { start, end }).pipe(response);
  });
  return new Promise<{ server: Server; origin: string }>((resolve) =>
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({ server, origin: `http://127.0.0.1:${(address as { port: number }).port}` });
    }),
  );
}

test.describe.configure({ mode: 'serial' });
let context: BrowserContext;
let site: { server: Server; origin: string };
let extensionId = '';
const temporary: string[] = [];

test.beforeAll(async () => {
  site = await startSite();
  // The toolbar click that grants activeTab cannot be automated, so this test copy of the
  // extension is granted the stand-in site up front. The shipped manifest asks for no hosts.
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-bridge-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-bridge-profile-'));
  temporary.push(extension, profile);
  fs.cpSync(path.resolve('extension'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['http://127.0.0.1/*'];
  fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  // Branded Chrome ignores --load-extension, so stay on Playwright's Chromium even when
  // PLAYWRIGHT_CHROME_PATH selects Chrome for the other specs.
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    executablePath: chromium.executablePath(),
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${extension}`,
      `--load-extension=${extension}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  extensionId = new URL(worker.url()).host;
  await worker.evaluate((origin) => chrome.storage.local.set({ origin }), hibiki);
});

test.afterAll(async () => {
  await context?.close();
  await new Promise((resolve) => site?.server.close(resolve));
  for (const directory of temporary) fs.rmSync(directory, { recursive: true, force: true });
});

async function practiseFromPopup(pageUrl: string) {
  const video = await context.newPage();
  await video.goto(pageUrl);
  await expect
    .poll(() => video.evaluate(() => document.querySelector('video')!.readyState))
    .toBeGreaterThan(0);
  const worker = context.serviceWorkers()[0];
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
    pageUrl,
  );
  expect(tabId).toBeTruthy();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  const opened = context.waitForEvent('page', (page) => page.url().startsWith(hibiki));
  await popup.getByRole('button', { name: 'Practise in Hibiki' }).click();
  const lesson = await opened;
  await popup.close();
  return { video, lesson };
}

const paused = (video: Page) =>
  video.evaluate(() => (document.querySelector('video') as HTMLVideoElement).paused);

test("the page's own Japanese subtitles become a lesson that plays the page's video", async () => {
  test.setTimeout(120_000);
  const { video, lesson } = await practiseFromPopup(`${site.origin}/video.html`);
  await expect(lesson).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 30_000 });
  await expect(lesson.getByRole('heading', { level: 1, name: '朝の散歩 · Fixture' })).toBeVisible();
  await expect(lesson.getByText('Playing in its own tab on 127.0.0.1.')).toBeVisible();
  await expect(lesson.getByText('毎朝、七時ごろに起きます。').first()).toBeVisible();
  await expect(lesson.getByText('Subtitles from the page')).toBeVisible();

  await lesson.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => paused(video)).toBe(false);
  // Hibiki's current line is shown over the original video.
  await expect(
    video.locator('div[aria-hidden="true"]', { hasText: 'おはようございます。' }),
  ).toBeVisible();
  // Shadowing pauses the page's video at the end of the section for the learner's turn.
  await expect.poll(() => paused(video), { timeout: 20_000 }).toBe(true);
  const time = await video.evaluate(() => document.querySelector('video')!.currentTime);
  const firstSectionEnd = await lesson.evaluate(() => {
    const id = decodeURIComponent(location.pathname.split('/').at(-1)!);
    return JSON.parse(localStorage.getItem(`hibiki:v1:lesson:${id}`)!).segments[0].end as number;
  });
  expect(Math.abs(time - firstSectionEnd)).toBeLessThan(0.75);
});

test('a page video without subtitles gets Whisper subtitles from its own audio', async () => {
  test.setTimeout(120_000);
  await mockProAccount(context);
  const uploads: Buffer[] = [];
  await context.route('**/api/transcribe', async (route) => {
    uploads.push(route.request().postDataBuffer()!);
    await route.fulfill({
      json: {
        cues: [{ start: 0.5, end: 3, text: '日本語を練習します。' }],
        provider: 'fixture Whisper',
      },
    });
  });
  const { video, lesson } = await practiseFromPopup(`${site.origin}/plain.html`);
  const dialog = lesson.getByRole('dialog', { name: 'Your next listening session.' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('127.0.0.1 · 1:')).toBeVisible();
  await dialog.getByRole('button', { name: 'Auto-generate subtitles' }).click();
  await dialog.getByRole('button', { name: 'Generate subtitles & start' }).click();
  await expect.poll(() => paused(video)).toBe(false);
  await expect(dialog.getByText(/Listening along/)).toBeVisible();
  await video.waitForTimeout(4000);
  await dialog.getByRole('button', { name: 'Finish with what was heard so far' }).click();
  await expect(lesson).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 30_000 });
  await expect(lesson.getByText('日本語を練習します。').first()).toBeVisible();
  await expect(lesson.getByText('AI subtitles')).toBeVisible();
  // One mono 16 kHz WAV window covering the seconds that played.
  expect(uploads).toHaveLength(1);
  const wav = uploads[0];
  expect(wav.subarray(0, 4).toString()).toBe('RIFF');
  expect(wav.readUInt32LE(24)).toBe(16000);
  const seconds = (wav.length - 44) / 32000;
  expect(seconds).toBeGreaterThan(2);
  expect(seconds).toBeLessThan(15);
});
