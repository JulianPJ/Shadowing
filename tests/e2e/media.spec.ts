import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import demo from '../../src/data/demo.json' with { type: 'json' };

const id = 'IJ6R4u05ppw';
const videoUrl = `https://www.youtube.com/watch?v=${id}`;
const transcript =
  '00:00:00.000 --> 00:00:03.500\n今日はいい天気ですね。\n\n00:00:04.000 --> 00:00:07.000\n日本語を練習します。';
const ass =
  '[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:03.50,Default,,0,0,0,,{\\i1}今日はいい天気ですね。';
const resolvedYoutube = {
  originalUrl: videoUrl,
  title: 'Captionless video',
  author: 'Original creator',
  media: {
    schemaVersion: 1,
    type: 'youtube',
    provider: 'youtube',
    videoId: id,
    canonicalUrl: videoUrl,
    contentKey: `youtube:${id}`,
  },
};
async function mockYouTube(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.YT = { Player: class {
    constructor(target, options) {
      this.video = document.createElement('video'); this.video.src = ${JSON.stringify(origin + '/demo.mp4')}; this.video.controls = true;
      this.iframe = document.createElement('iframe'); this.iframe.hidden = true; target.replaceWith(this.video, this.iframe);
      this.video.addEventListener('loadedmetadata', () => options.events.onReady());
      this.video.addEventListener('playing', () => options.events.onStateChange({data:1}));
      this.video.addEventListener('pause', () => options.events.onStateChange({data:2}));
      this.video.addEventListener('ended', () => options.events.onStateChange({data:0}));
    }
    playVideo(){ void this.video.play(); } pauseVideo(){this.video.pause();} seekTo(t){this.video.currentTime=t;}
    getCurrentTime(){return this.video.currentTime;} setPlaybackRate(r){this.video.playbackRate=r;}
    getPlayerState(){return this.video.ended ? 0 : this.video.paused ? 2 : 1;} getIframe(){return this.iframe;}
    destroy(){this.video.pause();this.video.remove();this.iframe.remove();}
  }}; window.onYouTubeIframeAPIReady();`,
    }),
  );
}
async function startLink(page: Page, link: string) {
  await page.getByRole('textbox', { name: 'Paste a Japanese video link' }).fill(link);
  await page.getByRole('button', { name: 'Start shadowing', exact: true }).click();
}
test('generic homepage and existing YouTube preparation/playback work through mocked boundaries', async ({
  page,
}) => {
  await page.goto('/');
  await mockYouTube(page);
  await page.route('**/api/prepare', (route) => {
    expect(route.request().postDataJSON().url).toBe(videoUrl);
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          lesson: {
            ...demo,
            id: `youtube-${id}`,
            videoId: id,
            source: 'youtube',
            mediaUrl: undefined,
            mediaSource: resolvedYoutube.media,
            transcriptSource: 'production-relay',
          },
        }) + '\n',
    });
  });
  await startLink(page, `https://youtu.be/${id}`);
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
});
test('no-captions → own transcript retains link, identity, title and author without a second preparation request', async ({
  page,
}) => {
  await page.goto('/');
  await mockYouTube(page);
  let requests = 0;
  await page.route('**/api/prepare', (route) => {
    requests++;
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          code: 'no-japanese-captions',
          error: 'This video has no Japanese captions.',
          resolved: resolvedYoutube,
        }) + '\n',
    });
  });
  await startLink(page, `https://youtu.be/${id}`);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByLabel('Video link', { exact: true })).toHaveValue(
    `https://youtu.be/${id}`,
  );
  await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
  await page.getByLabel('Paste timestamped transcript').fill(transcript);
  await page.getByRole('button', { name: 'Start practicing', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Captionless video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  const lesson = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    `hibiki:v1:lesson:youtube-${id}`,
  );
  expect(lesson.mediaSource.contentKey).toBe(`youtube:${id}`);
  expect(lesson.author).toBe('Original creator');
  expect(lesson.transcript.type).toBe('user-paste');
  expect(requests).toBe(1);
});
test('captionless link generates subtitles from attached media while preserving link identity', async ({
  page,
}) => {
  await page.goto('/');
  await mockYouTube(page);
  await page.route('**/api/prepare', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          code: 'no-japanese-captions',
          error: 'This video has no Japanese captions.',
          resolved: resolvedYoutube,
        }) + '\n',
    }),
  );
  let transcriptions = 0;
  await page.route('**/api/transcribe', async (route) => {
    transcriptions++;
    expect(route.request().headers()['content-type']).toContain('video/mp4');
    expect(route.request().postDataBuffer()?.byteLength).toBeGreaterThan(1000);
    return route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        cues: [
          { start: 0, end: 3.5, text: '今日はいい天気ですね。' },
          { start: 4, end: 7, text: '日本語を練習します。' },
        ],
        provider: 'Cloudflare Whisper large-v3-turbo',
      }),
    });
  });
  await startLink(page, videoUrl);
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Upload own subtitles', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Auto-generate subtitles', exact: true })).toBeVisible();
  expect(transcriptions).toBe(0);
  await page.getByRole('button', { name: 'Auto-generate subtitles', exact: true }).click();
  expect(transcriptions).toBe(0);
  await page.getByLabel('Audio or video for subtitle generation').setInputFiles({
    name: 'captionless-source.mp4',
    mimeType: 'video/mp4',
    buffer: fs.readFileSync('public/demo.mp4'),
  });
  expect(transcriptions).toBe(0);
  await page.getByRole('button', { name: 'Generate subtitles & start', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Captionless video' })).toBeVisible();
  const lesson = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!),
    `hibiki:v1:lesson:youtube-${id}`,
  );
  expect(transcriptions).toBe(1);
  expect(lesson.mediaSource.contentKey).toBe(`youtube:${id}`);
  expect(lesson.transcript.type).toBe('generated');
  expect(lesson.transcript.provider).toBe('Cloudflare Whisper large-v3-turbo');
});

test('infrastructure failures keep retry/recovery available without opening a no-caption dialog', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('**/api/prepare', (route) =>
    route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          code: 'network',
          error: 'The caption service could not be reached. Try again or import a transcript.',
          resolved: resolvedYoutube,
        }) + '\n',
    }),
  );
  await startLink(page, videoUrl);
  await expect(page.locator('.error-message[role="alert"]')).toContainText('could not be reached');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Import a transcript', exact: false }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog')).not.toContainText('No Japanese subtitles were found');
  await expect(page.getByRole('dialog').getByLabel('Video link', { exact: true })).toHaveValue(
    videoUrl,
  );
});
for (const extension of ['ass', 'ssa'])
  test(`direct media + ${extension.toUpperCase()} transcript retains the link, plays shadowing and fits mobile`, async ({
    page,
    baseURL,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const link = `${baseURL}/demo.mp4`;
    await startLink(page, link);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Video link', { exact: true })).toHaveValue(link);
    await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
    await page.getByLabel('Japanese subtitle file').setInputFiles({
      name: `lesson.${extension}`,
      mimeType: 'text/plain',
      buffer: Buffer.from(
        extension === 'ass' ? ass : ass.replace('Layer', 'Marked').replace('v4.00+', 'v4.00'),
      ),
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({ path: `artifacts/import-${extension}-mobile.png`, fullPage: true });
    await page.getByRole('button', { name: 'Start practicing', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.25');
    await page.getByRole('button', { name: 'Listen', exact: true }).click();
    await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
    expect(await page.locator('video').evaluate((v: HTMLVideoElement) => v.playbackRate)).toBe(
      1.25,
    );
    await page.reload();
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Reattach media')).toHaveCount(0);
  });
test('manual video-link import accepts timed TXT and rejects untimed text without inventing cues', async ({
  page,
  baseURL,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media or subtitles' }).click();
  await page.getByLabel('Video link', { exact: true }).fill(`${baseURL}/demo.mp4`);
  await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
  await page.getByLabel('Paste timestamped transcript').fill('こんにちは。');
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText(
    'Plain text needs timestamps',
  );
  await page
    .getByLabel('Japanese subtitle file')
    .setInputFiles({ name: 'lesson.txt', mimeType: 'text/plain', buffer: Buffer.from(transcript) });
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
});
test('public page discovery extracts media and metadata inertly, exposes the link, and never executes page scripts or iframes', async ({
  page,
}) => {
  await page.goto('/');
  const mediaBytes = fs.readFileSync('public/demo.mp4');
  await page.route('https://media.example.test/clip.mp4*', (route) =>
    route.fulfill({ contentType: 'video/mp4', body: mediaBytes }),
  );
  await page.route('https://page.example.test/watch', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: '<title>Extracted Japanese video</title><meta name="author" content="Creator"><video><source src="https://media.example.test/clip.mp4?token=secret" type="video/mp4"></video><script>window.pwned=true</script><iframe src="https://forbidden.example.test"></iframe>',
    }),
  );
  let forbidden = 0;
  page.on('request', (request) => {
    if (request.url().includes('forbidden.example')) forbidden++;
  });
  await startLink(page, 'https://page.example.test/watch');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open extracted media' })).toHaveAttribute(
    'href',
    'https://media.example.test/clip.mp4?token=secret',
  );
  expect(
    await page.evaluate(() => (window as unknown as { pwned?: boolean }).pwned),
  ).toBeUndefined();
  expect(forbidden).toBe(0);
  await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
  await page.getByLabel('Paste timestamped transcript').fill(transcript);
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByRole('heading', { name: 'Extracted Japanese video' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  const lesson = await page.evaluate(
    () => JSON.parse(localStorage.getItem('hibiki:v1:history')!)[0].lesson,
  );
  expect(lesson.mediaSource.discoveredFrom).toBe('https://page.example.test/watch');
  expect(lesson.id).not.toContain('secret');
});
test('metadata discovery supports OpenGraph and JSON-LD, and inaccessible/iframe-only pages remain unsupported', async ({
  page,
}) => {
  await page.goto('/');
  for (const [name, html] of [
    ['og', '<meta property="og:video" content="https://media.example.test/a.mp4">'],
    [
      'json',
      '<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://media.example.test/b.webm"}</script>',
    ],
    [
      'typed',
      '<video><source src="https://media.example.test/play?id=7" type="video/mp4"></video>',
    ],
  ]) {
    await page.route(`https://page.example.test/${name}`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: html,
      }),
    );
    await startLink(page, `https://page.example.test/${name}`);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Open extracted media' })).toBeVisible();
    await page.getByRole('button', { name: 'Close import', exact: true }).click();
  }
  for (const html of [
    '<iframe src="https://thirdparty.test/player"></iframe>',
    '<video src="javascript:alert(1)"></video>',
    '<video src="https://127.0.0.1/a.mp4"></video>',
  ]) {
    await page.route('https://page.example.test/unsupported', (route) =>
      route.fulfill({
        contentType: 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: html,
      }),
    );
    await startLink(page, 'https://page.example.test/unsupported');
    await expect(page.locator('.error-message[role="alert"]')).toContainText(
      'does not expose a supported player',
    );
    await page.unroute('https://page.example.test/unsupported');
  }
  await page.route('https://page.example.test/blocked', (route) => route.abort('blockedbyclient'));
  await startLink(page, 'https://page.example.test/blocked');
  await expect(page.locator('.error-message[role="alert"]')).toContainText(
    'direct audio/video link',
  );
});
test('discovery bounds HTML, rejects redirects without following them, and recognizes extensionless direct media by MIME', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('https://page.example.test/large', (route) =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: ' '.repeat(1_000_001),
    }),
  );
  await startLink(page, 'https://page.example.test/large');
  await expect(page.locator('.error-message[role="alert"]')).toContainText(
    'does not expose a supported player',
  );
  let followed = 0;
  await page.route('https://page.example.test/redirect', (route) =>
    route.fulfill({
      status: 302,
      headers: {
        'Access-Control-Allow-Origin': '*',
        Location: 'https://protected.example.test/page',
      },
    }),
  );
  await page.route('https://protected.example.test/page', (route) => {
    followed++;
    return route.abort();
  });
  await startLink(page, 'https://page.example.test/redirect');
  await expect(page.locator('.error-message[role="alert"]')).toContainText(
    'does not expose a supported player',
  );
  expect(followed).toBe(0);
  await page.route('https://media.example.test/play?id=7', (route) =>
    route.fulfill({
      contentType: 'video/mp4',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: fs.readFileSync('public/demo.mp4'),
    }),
  );
  await startLink(page, 'https://media.example.test/play?id=7');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByLabel('Video link', { exact: true })).toHaveValue(
    'https://media.example.test/play?id=7',
  );
});
test('expanded local media selection reports browser decoding errors cleanly', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media or subtitles' }).click();
  await page.getByRole('button', { name: 'Own media', exact: true }).click();
  await expect(page.getByLabel('Audio or video file')).toHaveAttribute('accept', /\.flac/);
  await page.getByLabel('Audio or video file').setInputFiles({
    name: 'unreadable.flac',
    mimeType: 'audio/flac',
    buffer: Buffer.from('not a valid encoded audio file'),
  });
  await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
  await page.getByLabel('Paste timestamped transcript').fill(transcript);
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.locator('.media-error')).toContainText('could not decode the selected media');
});
test('Vimeo adapter exercises real SDK message boundary with mocked embedded playback controls', async ({
  page,
}) => {
  await page.goto('/');
  await page.route('https://player.vimeo.com/mock-media.mp4', (route) =>
    route.fulfill({ contentType: 'video/mp4', body: fs.readFileSync('public/demo.mp4') }),
  );
  await page.route('https://player.vimeo.com/video/123456*', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: `<video id="video" src="https://player.vimeo.com/mock-media.mp4" controls></video><script>
    const v=document.getElementById('video'); const send=data=>parent.postMessage(data,'*');
    for(const event of ['playing','pause','ended']) v.addEventListener(event,()=>send({event,data:{seconds:v.currentTime}}));
    v.addEventListener('loadedmetadata',()=>send({event:'ready'}));
    addEventListener('message',async event=>{ const data=typeof event.data==='string'?JSON.parse(event.data):event.data; const m=data.method; let value;
      if(m==='ping') value=true;
      else if(m==='getDuration') value=v.duration||57;
      else if(m==='getCurrentTime') value=v.currentTime;
      else if(m==='getPaused') value=v.paused;
      else if(m==='setCurrentTime') {v.currentTime=data.value;value=v.currentTime;}
      else if(m==='setPlaybackRate') {if(data.value===0.5) {send({event:'error',data:{method:m,name:'UnsupportedError',message:'Creator disabled speed'}});return;} v.playbackRate=data.value;value=v.playbackRate;}
      else if(m==='play') await v.play(); else if(m==='pause') v.pause();
      send({method:m,value});
    });</script>`,
    }),
  );
  await startLink(page, 'https://vimeo.com/123456');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
  await page.getByLabel('Paste timestamped transcript').fill(transcript);
  await page.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toContainText('日本語を練習');
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('1.25');
  await expect
    .poll(() =>
      page
        .frameLocator('iframe.vimeo-host')
        .locator('video')
        .evaluate((v: HTMLVideoElement) => v.playbackRate),
    )
    .toBe(1.25);
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('0.5');
  await expect(page.locator('.media-frame')).toContainText(
    'Vimeo has not allowed this speed change',
  );
  await expect(page.locator('.media-error')).toHaveCount(0);
});
