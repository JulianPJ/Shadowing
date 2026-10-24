import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mockProAccount, proStorageKey } from '../helpers/pro-account';
import { mockJimaku } from '../helpers/jimaku';

// Hibiki Bridge: Hibiki plays and subtitles a video on another site through the extension.
// The extension APIs these tests call inside its service worker.
declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void> } };
  tabs: { query(filter: Record<string, unknown>): Promise<{ id?: number; url?: string }[]> };
};
const hibiki = new URL(process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001').origin;
// The site serves its video only to requests carrying its own Referer, like a hotlink-protected
// stream server, so Hibiki can play it only through Hibiki Bridge.
const fixturePage = (track: boolean) => `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>朝の散歩 · Fixture</title></head>
<body><video controls width="640" height="360" src="/protected.mp4" crossorigin="anonymous">${
  track ? '<track kind="subtitles" srclang="ja" label="日本語" src="/demo.vtt">' : ''
}</video></body></html>`;
// A player that feeds its video from script (a blob: URL), leaving no stream to hand over.
const scriptedPage = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>朝の散歩 · Scripted fixture</title></head>
<body><video controls width="640" height="360" crossorigin="anonymous">
<track kind="subtitles" srclang="ja" label="日本語" src="/demo.vtt"></video>
<script>fetch('/demo.mp4').then((response) => response.blob()).then((blob) => {
  document.querySelector('video').src = URL.createObjectURL(blob);
});</script></body></html>`;
// Like Vidstack: the player keeps its own track list and fetches a file only once a track is on.
const playerPage = String.raw`<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>朝の散歩 · Player fixture</title></head>
<body><media-player><video controls width="640" height="360" src="/demo.mp4" crossorigin="anonymous"></video></media-player>
<script>
class Track {
  constructor(label, language, src) {
    Object.assign(this, { kind: 'subtitles', label, language, src, cues: [], current: 'disabled' });
  }
  get mode() { return this.current; }
  set mode(value) {
    this.current = value;
    if (value === 'disabled' || this.cues.length || !this.src) return;
    fetch(this.src).then((response) => response.text()).then((text) => {
      this.cues = [...text.matchAll(/(\d+):(\d+):([\d.]+) --> (\d+):(\d+):([\d.]+)\r?\n(.+)/g)].map(
        (m) => ({ startTime: m[1] * 3600 + m[2] * 60 + +m[3], endTime: m[4] * 3600 + m[5] * 60 + +m[6], text: m[7] }),
      );
    });
  }
}
customElements.define('media-player', class extends HTMLElement {
  textTracks = [new Track('English', 'en', null), new Track('Japanese', 'ja', '/demo.vtt')];
});
</script></body></html>`;

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
    if (url.pathname === '/player.html' || url.pathname === '/scripted.html') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(url.pathname === '/player.html' ? playerPage : scriptedPage);
      return;
    }
    if (
      url.pathname === '/protected.mp4' &&
      !(request.headers.referer ?? '').startsWith(`http://${request.headers.host}/`)
    ) {
      response.writeHead(403).end();
      return;
    }
    const file = files[url.pathname === '/protected.mp4' ? '/demo.mp4' : url.pathname];
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
  // extension is granted all sites up front, as a learner does when the popup first asks to
  // play a video inside Hibiki. The shipped manifest asks for no hosts.
  const extension = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-bridge-'));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hibiki-bridge-profile-'));
  temporary.push(extension, profile);
  fs.cpSync(path.resolve('extension'), extension, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  manifest.host_permissions = ['<all_urls>'];
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
const firstSectionEnd = (lesson: Page) =>
  lesson.evaluate(() => {
    const id = decodeURIComponent(location.pathname.split('/').at(-1)!);
    return JSON.parse(localStorage.getItem(`hibiki:v1:lesson:${id}`)!).segments[0].end as number;
  });

test("the page's own Japanese subtitles become a lesson that plays inside Hibiki", async () => {
  test.setTimeout(120_000);
  const { video, lesson } = await practiseFromPopup(`${site.origin}/video.html`);
  await expect(lesson).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 30_000 });
  await expect(lesson.getByRole('heading', { level: 1, name: '朝の散歩 · Fixture' })).toBeVisible();
  await expect(lesson.getByText('毎朝、七時ごろに起きます。').first()).toBeVisible();
  await expect(lesson.getByText('Subtitles from the page')).toBeVisible();
  // The site's protected video plays in Hibiki's own player, not in its tab.
  const player = lesson.locator('.media-frame video');
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(0);
  await expect(lesson.getByText(/Playing in its own tab/)).toHaveCount(0);

  await lesson.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect.poll(() => player.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  expect(await paused(video)).toBe(true);
  // Shadowing pauses at the end of the section, as precisely as a direct link.
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.paused), { timeout: 20_000 })
    .toBe(true);
  const time = await player.evaluate((v: HTMLVideoElement) => v.currentTime);
  expect(Math.abs(time - (await firstSectionEnd(lesson)))).toBeLessThan(0.25);
});

test('a page link pasted into Hibiki opens through Hibiki Bridge and plays inside Hibiki', async () => {
  test.setTimeout(120_000);
  const pageUrl = `${site.origin}/video.html?pasted`;
  const home = await context.newPage();
  await home.goto(`${hibiki}/`);
  await home.locator('#video-url').fill(pageUrl);
  await home.getByRole('button', { name: 'Start shadowing' }).click();
  await expect(home).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 45_000 });
  await expect(home.getByText('Subtitles from the page')).toBeVisible();
  const player = home.locator('.media-frame video');
  await expect
    .poll(() => player.evaluate((v: HTMLVideoElement) => v.readyState))
    .toBeGreaterThan(0);
  await expect(home.getByText(/Playing in its own tab/)).toHaveCount(0);
  // The tab opened in the background for the link closes once Hibiki plays its stream.
  await expect.poll(() => context.pages().filter((page) => page.url() === pageUrl).length).toBe(0);
});

test('a page video with no stream to hand over plays in its own tab under Hibiki', async () => {
  test.setTimeout(120_000);
  const { video, lesson } = await practiseFromPopup(`${site.origin}/scripted.html`);
  await expect(lesson).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 30_000 });
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
  expect(Math.abs(time - (await firstSectionEnd(lesson)))).toBeLessThan(0.75);
});

test('a player that loads subtitles only on request still hands over its Japanese track', async () => {
  test.setTimeout(120_000);
  const { video, lesson } = await practiseFromPopup(`${site.origin}/player.html`);
  await expect(lesson).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 30_000 });
  await expect(lesson.getByText('毎朝、七時ごろに起きます。').first()).toBeVisible();
  await expect(lesson.getByText('Subtitles from the page')).toBeVisible();
  // The track was read while hidden, and the page's own subtitle choice is left as it was.
  const modes = await video.evaluate(() =>
    (
      document.querySelector('media-player') as unknown as { textTracks: { mode: string }[] }
    ).textTracks.map((track) => track.mode),
  );
  expect(modes).toEqual(['disabled', 'disabled']);
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

test('a page video without Japanese subtitles finds them on Jimaku straight away', async () => {
  test.setTimeout(120_000);
  await mockProAccount(context);
  await context.addInitScript((key) => {
    const saved = { jimaku: { key: 'jimaku-test-key', savedAt: '2026-10-01T00:00:00.000Z' } };
    localStorage.setItem(key, JSON.stringify(saved));
  }, proStorageKey('subtitle-sources'));
  const requests = await mockJimaku(context);
  const { lesson } = await practiseFromPopup(`${site.origin}/plain.html?jimaku`);
  const dialog = lesson.getByRole('dialog', { name: 'Your next listening session.' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByText('This video has no Japanese subtitles.')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Find on Jimaku' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  // Searched by the page's title, without the site's name; the first episode file is chosen.
  await expect(dialog.getByLabel('Title')).toHaveValue('朝の散歩');
  await expect(dialog.getByRole('radio', { name: /Asa no Sanpo - 01\.ja\.srt/ })).toBeChecked();
  expect(requests[0].path).toBe(`/api/entries/search?query=${encodeURIComponent('朝の散歩')}`);
  await dialog.getByRole('button', { name: 'Start practicing' }).click();
  await expect(lesson).toHaveURL(/\/practice\/page-[a-f0-9]{64}/, { timeout: 30_000 });
  await expect(lesson.getByText('ジマクから届いた字幕です。').first()).toBeVisible();
  await expect(lesson.getByText('Subtitles from Jimaku')).toBeVisible();
  await context.unroute('https://jimaku.cc/**');
});

test('YouTube has one popup choice and requests native captions', async () => {
  test.setTimeout(120_000);
  const id = 'dQw4w9WgXcQ';
  const canonical = `https://www.youtube.com/watch?v=${id}`;
  const watch = `${canonical}&list=PL123`;
  await context.route('https://www.youtube.com/watch**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: [
        '<!doctype html><html><title>YouTube fixture</title><body>',
        '<video></video><video></video></body></html>',
      ].join(''),
    }),
  );
  let preparedUrl = '';
  await context.route('**/api/prepare', async (route) => {
    preparedUrl = route.request().postDataJSON().url;
    await route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          code: 'no-japanese-captions',
          error: 'No Japanese captions in this test fixture',
        }) + '\n',
    });
  });
  const video = await context.newPage();
  await video.goto(watch);
  const worker = context.serviceWorkers()[0];
  const tabId = await worker.evaluate(
    async (url) => (await chrome.tabs.query({})).find((tab) => tab.url === url)?.id,
    watch,
  );
  expect(tabId).toBeTruthy();
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html?tab=${tabId}`);
  await expect(popup.getByRole('button', { name: 'Practise in Hibiki' })).toHaveCount(1);
  const youtubeSummary = popup.getByText(
    'YouTube video · Japanese subtitles checked automatically',
  );
  await expect(youtubeSummary).toBeVisible();

  const openedPromise = context.waitForEvent('page', (page) => page.url().startsWith(hibiki));
  await popup.getByRole('button', { name: 'Practise in Hibiki' }).click();
  const opened = await openedPromise;
  await expect(opened).toHaveURL(/\/prepare\?video=/);
  await expect.poll(() => preparedUrl).toBe(canonical);
  await expect(opened.getByRole('dialog', { name: 'Your next listening session.' })).toBeVisible();

  await popup.close();
  await opened.close();
  await video.close();
  await context.unroute('https://www.youtube.com/watch**');
  await context.unroute('**/api/prepare');
});
