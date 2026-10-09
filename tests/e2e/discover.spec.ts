import { test, expect, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { buildFeed } from '../../src/lib/discover/rank';
import { normalizeFilters, validateContext } from '../../src/lib/discover/validation';
import { BANDS, DEFAULT_PREFERENCES, canonicalUrl } from '../../src/lib/discover/types';
import { discoveryVideo } from '../helpers/discover';
import { mergeWatchRecords, type WatchRecord } from '../../src/lib/discover/watch-later';
import { mockProAccount, proStorageKey } from '../helpers/pro-account';
const videos = Array.from({ length: 36 }, (_, i) =>
  discoveryVideo(i, {
    band: i === 0 ? null : BANDS[i % 6][0],
    prepared: i % 2 === 0,
    speed: (i % 5) + 1,
    topics: [i % 3 === 0 ? 'travel' : i % 3 === 1 ? 'food' : 'everyday'],
    durationSeconds: i % 2 === 0 ? 540 : 900,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  }),
);
async function catalog(page: Page) {
  const rankingTime = Date.now();
  await page.route('**/api/discover', async (route) => {
    const body = route.request().postDataJSON();
    const feed = await buildFeed(
      videos,
      normalizeFilters(body.filters),
      validateContext(body.context),
      body.cursor,
      'JP',
      rankingTime,
    );
    await route.fulfill({ json: feed });
  });
  await page.route('https://i.ytimg.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270"><rect width="480" height="270" fill="#bfd5c9"/><circle cx="370" cy="65" r="35" fill="#ffe2a6"/><path d="M0 235L130 85L270 235L380 150L480 235" fill="#6c9987"/><rect x="170" y="180" width="140" height="90" fill="#bc7c66"/></svg>',
    }),
  );
}
async function mockPlayer(page: Page) {
  const origin = new URL(page.url()).origin;
  await page.route('https://www.youtube.com/iframe_api', (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `window.YT={Player:class{constructor(target,options){this.video=document.createElement('video');this.video.src=${JSON.stringify(origin + '/demo.mp4')};this.iframe=document.createElement('iframe');this.iframe.hidden=true;target.replaceWith(this.video,this.iframe);this.video.addEventListener('loadedmetadata',()=>options.events.onReady());this.video.addEventListener('playing',()=>options.events.onStateChange({data:1}));this.video.addEventListener('pause',()=>options.events.onStateChange({data:2}));}playVideo(){void this.video.play()}pauseVideo(){this.video.pause()}seekTo(t){this.video.currentTime=t}getCurrentTime(){return this.video.currentTime}setPlaybackRate(r){this.video.playbackRate=r}getPlayerState(){return this.video.paused?2:1}getIframe(){return this.iframe}destroy(){this.video.pause();this.video.remove();this.iframe.remove()}}};window.onYouTubeIframeAPIReady();`,
    }),
  );
}
test.beforeEach(async ({ page }) => {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
  await page.route('**/api/discovery', (route) =>
    route.fulfill({ json: { lessons: [], difficulties: [] } }),
  );
  await catalog(page);
});
test('feed browses all six bands, filters, persists search and never prepares on scroll', async ({
  page,
}) => {
  let preparation = 0,
    ai = 0;
  await page.route('**/api/prepare', (route) => {
    preparation++;
    return route.abort();
  });
  await page.route(/\/api\/(difficulty|transcribe|quiz)$/, (route) => {
    ai++;
    return route.abort();
  });
  await page.goto('/discover');
  await expect(
    page.getByRole('heading', { name: 'Find something worth listening to.' }),
  ).toBeVisible();
  await expect(page.locator('.discover-card')).not.toHaveCount(0);
  for (const [, label] of BANDS)
    await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'N4–N3', exact: true }).click();
  await expect(page.locator('.discover-card')).toHaveCount(6);
  await expect(page.locator('.discover-band').first()).toContainText('N4–N3');
  await page.getByLabel('Duration', { exact: true }).selectOption('5to10');
  await page.getByLabel('Search Japanese videos').fill('moment 2');
  await page.getByRole('button', { name: 'Search videos', exact: true }).click();
  await expect(page.locator('.discover-card')).toHaveCount(3);
  await page.reload();
  await expect(page.getByLabel('Search Japanese videos')).toHaveValue('moment 2');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(preparation).toBe(0);
  expect(ai).toBe(0);
  await page.getByRole('button', { name: 'Clear all', exact: true }).click();
  await expect(page.getByLabel('Search Japanese videos')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'For you', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
test('save and undo persist through Library and trigger no preparation', async ({ page }) => {
  let preparation = 0;
  await page.route('**/api/prepare', (route) => {
    preparation++;
    return route.abort();
  });
  await page.goto('/discover?band=all');
  const card = page.locator('.discover-card').first(),
    title = await card.locator('h3').innerText();
  await card.getByRole('button', { name: /^Save .* to Watch Later$/ }).click();
  await expect(card.getByRole('button', { name: /^Remove .* from Watch Later$/ })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(card.getByRole('button', { name: /^Save .* to Watch Later$/ })).toBeVisible();
  await card.getByRole('button', { name: /^Save .* to Watch Later$/ }).click();
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-queue')).toContainText(title);
  await page.reload();
  await expect(page.locator('.library-queue li')).toHaveCount(1);
  expect(preparation).toBe(0);
});
test('a card click auto-starts existing preparation and opens ordinary practice once', async ({
  page,
}) => {
  await page.goto('/discover?band=all');
  await mockPlayer(page);
  let preparation = 0;
  await page.route('**/api/prepare', (route) => {
    preparation++;
    const url = route.request().postDataJSON().url;
    const id = new URL(url).searchParams.get('v');
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          stage: 'done',
          lesson: {
            ...demo,
            id: `youtube-${id}`,
            videoId: id,
            source: 'youtube',
            mediaSource: {
              schemaVersion: 1,
              type: 'youtube',
              provider: 'youtube',
              videoId: id,
              canonicalUrl: url,
              contentKey: `youtube:${id}`,
            },
            title: 'Discover practice fixture',
          },
        }) + '\n',
    });
  });
  const link = page.locator('.discover-card-link').first();
  await link.scrollIntoViewIfNeeded();
  const scroll = await page.evaluate(() => window.scrollY);
  await link.click();
  await expect(page).toHaveURL(/\/practice\/youtube-/);
  await expect(page.getByRole('heading', { name: 'Discover practice fixture' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  expect(preparation).toBe(1);
  await page.goBack();
  await expect(page).toHaveURL(/\/discover\?band=all$/);
  await expect(page.getByRole('button', { name: 'All levels', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(scroll - 5);
  expect(preparation).toBe(1);
});
test('caption absence opens current subtitle-choice flow without another start click', async ({
  page,
}) => {
  await page.goto('/discover?band=all');
  let preparation = 0;
  await page.route('**/api/prepare', (route) => {
    preparation++;
    const url = route.request().postDataJSON().url;
    const id = new URL(url).searchParams.get('v');
    return route.fulfill({
      contentType: 'application/x-ndjson',
      body:
        JSON.stringify({
          code: 'no-japanese-captions',
          error: 'This video has no Japanese captions.',
          resolved: {
            originalUrl: url,
            title: 'Captionless',
            author: 'Creator',
            media: {
              schemaVersion: 1,
              type: 'youtube',
              provider: 'youtube',
              videoId: id,
              canonicalUrl: url,
              contentKey: `youtube:${id}`,
            },
          },
        }) + '\n',
    });
  });
  await page.locator('.discover-card-link').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Upload own subtitles', exact: true }),
  ).toBeVisible();
  expect(preparation).toBe(1);
});
test('preferences do not change practice history and feedback has undo', async ({ page }) => {
  await page.goto('/discover');
  await page.getByRole('button', { name: 'Edit level' }).click();
  await page.getByLabel('Your preferred content level').selectOption('n4_n3');
  await page.getByRole('dialog').getByLabel('Travel', { exact: true }).check();
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.locator('.discover-level-display')).toHaveText('N4–N3');
  const card = page.locator('.discover-card').first(),
    title = await card.locator('h3').innerText();
  await card.locator('summary').click();
  await card.getByRole('button', { name: 'Not interested', exact: true }).click();
  await expect(page.locator('.discover-card h3').filter({ hasText: title })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.discover-card h3').filter({ hasText: title })).toBeVisible();
  const preferences = await page.evaluate(() => ({
    discovery: JSON.parse(localStorage.getItem('hibiki:v1:discover:preferences')!),
    learning: localStorage.getItem('hibiki:v1:preferences'),
  }));
  expect(preferences.discovery.preferredBand).toBe('n4_n3');
  expect(preferences.learning).toBeNull();
});
test('pagination keeps lanes and cards deduplicated; back restores filter state', async ({
  page,
}) => {
  await page.goto('/discover?band=all');
  await expect(page.locator('.discover-card')).toHaveCount(24);
  await page.getByRole('button', { name: 'Discover more', exact: true }).click();
  await expect(page.locator('.discover-card')).toHaveCount(36);
  const names = await page.locator('.discover-card h3').allTextContents();
  expect(new Set(names).size).toBe(36);
  await page.getByLabel('Topic', { exact: true }).selectOption('travel');
  await expect(page.locator('.discover-card')).toHaveCount(12);
  await page.goBack();
  await expect(page.getByLabel('Topic', { exact: true })).toHaveValue('all');
  await expect(page.locator('.discover-card')).toHaveCount(24);
});
test('error recovery, empty filters, mobile and blocked storage stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new Error('Storage unavailable');
    };
  });
  await page.goto('/discover?band=all');
  await page
    .locator('.discover-card')
    .first()
    .getByRole('button', { name: /^Save .* to Watch Later$/ })
    .click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved for this visit' })).toBeVisible();
  await page.getByText('More ways to explore', { exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('combobox', { name: 'Variety', exact: true }).selectOption('wide');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByLabel('Search Japanese videos').fill('no-matching-videos');
  await page.getByRole('button', { name: 'Search videos', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Make a little more room to explore.' }),
  ).toBeVisible();
  await page.route('**/api/discover', (route) =>
    route.fulfill({ status: 503, json: { error: 'Temporary catalogue outage' } }),
  );
  await page.getByRole('button', { name: 'Reset filters', exact: true }).click();
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Temporary catalogue outage',
  );
  await page.unroute('**/api/discover');
  await catalog(page);
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.locator('.discover-card')).not.toHaveCount(0);
});
test('signed-in queue merges remote records, saves offline and syncs on reconnect without anonymous import', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      'hibiki:v1:library:data',
      JSON.stringify({
        version: 1,
        pinned: [],
        queue: [
          {
            id: 'anonymous',
            url: 'https://youtu.be/video000003',
            title: 'Device only',
            addedAt: new Date().toISOString(),
          },
        ],
      }),
    ),
  );
  await mockProAccount(page);
  await page.route('**/api/knowledge*', (route) =>
    route.fulfill({ json: { records: [], nextCursor: null } }),
  );
  let records: WatchRecord[] = [
      {
        videoId: 'video000035',
        title: 'Saved on another device',
        position: 0,
        addedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        removed: false,
      },
    ],
    offline = false;
  await page.route('**/api/watch-later', async (route) => {
    if (offline) return route.abort();
    if (route.request().method() === 'POST')
      records = mergeWatchRecords(records, route.request().postDataJSON().records);
    return route.fulfill({ json: { records } });
  });
  await page.route('**/api/discover/preferences', (route) =>
    route.fulfill({ json: { preferences: DEFAULT_PREFERENCES } }),
  );
  await page.route('**/api/discover/feedback', (route) =>
    route.fulfill({ json: { feedback: [] } }),
  );
  await page.route('**/api/discover/events', (route) => route.fulfill({ json: { ok: true } }));
  await page.goto('/library');
  await expect(page.locator('.library-queue')).toContainText('Saved on another device');
  await expect(page.locator('.library-queue')).not.toContainText('Device only');
  offline = true;
  await page.getByRole('link', { name: 'Discover', exact: true }).click();
  const card = page.locator('.discover-card').first();
  const title = await card.locator('h3').innerText();
  await card.getByRole('button', { name: /^Save .* to Watch Later$/ }).click();
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '[]').length,
        proStorageKey('library:watch-outbox'),
      ),
    )
    .toBeGreaterThan(0);
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => records.some((r) => r.title === title && !r.removed)).toBe(true);
  await page.getByRole('link', { name: 'Library', exact: true }).click();
  await expect(page.locator('.library-queue')).toContainText(title);
  await page
    .getByRole('button', { name: 'Add this device’s anonymous saves to my account', exact: true })
    .click();
  await expect(page.locator('.library-queue')).toContainText('Device only');
  expect(
    records.every((r) => canonicalUrl(r.videoId).startsWith('https://www.youtube.com/watch?v=')),
  ).toBe(true);
});

test('a long offline queue outbox reconnects in bounded batches without losing removals or the final save', async ({
  page,
}) => {
  await mockProAccount(page);
  await page.route('**/api/knowledge*', (route) =>
    route.fulfill({ json: { records: [], nextCursor: null } }),
  );
  const time = new Date(Date.now() - 60000).toISOString();
  const pending: WatchRecord[] = Array.from({ length: 141 }, (_, i) => ({
    videoId: `video${String(i).padStart(6, '0')}`,
    title: `Offline save ${i}`,
    position: i,
    addedAt: time,
    updatedAt: time,
    removed: i !== 140,
  }));
  await page.addInitScript(
    ({ key, pending }) => {
      localStorage.setItem(key, JSON.stringify(pending));
    },
    { key: proStorageKey('library:watch-outbox'), pending },
  );
  const writes: number[] = [];
  let remote: WatchRecord[] = [];
  await page.route('**/api/watch-later', (route) => {
    if (route.request().method() === 'POST') {
      const records = route.request().postDataJSON().records as WatchRecord[];
      writes.push(records.length);
      if (records.length > 120)
        return route.fulfill({ status: 400, json: { error: 'Invalid queue batch' } });
      remote = mergeWatchRecords(remote, records);
    }
    return route.fulfill({ json: { records: remote } });
  });
  await page.goto('/library');
  await expect(page.locator('.library-queue li')).toHaveCount(1);
  await expect(page.locator('.library-queue')).toContainText('Offline save 140');
  await expect.poll(() => remote.length).toBe(141);
  expect(writes).toEqual([120, 21]);
  await expect
    .poll(() =>
      page.evaluate(
        (key) => JSON.parse(localStorage.getItem(key) ?? '[]').length,
        proStorageKey('library:watch-outbox'),
      ),
    )
    .toBe(0);
});

test('a full account queue preserves device-only media and reveals retained account saves when a place is freed', async ({
  page,
}) => {
  await mockProAccount(page);
  await page.route('**/api/knowledge*', (route) =>
    route.fulfill({ json: { records: [], nextCursor: null } }),
  );
  const time = new Date().toISOString();
  const remote: WatchRecord[] = Array.from({ length: 40 }, (_, i) => ({
    videoId: `video${String(i).padStart(6, '0')}`,
    title: `Account save ${i}`,
    position: i,
    addedAt: time,
    updatedAt: time,
    removed: false,
  }));
  await page.addInitScript(
    ({ key, time }) =>
      localStorage.setItem(
        key,
        JSON.stringify({
          version: 1,
          pinned: [],
          queue: [
            {
              id: 'vimeo-local',
              url: 'https://vimeo.com/123456789',
              title: 'Device-only Vimeo',
              addedAt: time,
            },
          ],
        }),
      ),
    { key: proStorageKey('library:data'), time },
  );
  await page.route('**/api/watch-later', (route) => route.fulfill({ json: { records: remote } }));
  await page.goto('/library');
  await expect(page.locator('.library-queue li')).toHaveCount(40);
  await expect(page.locator('.library-queue')).toContainText('Device-only Vimeo');
  await expect(
    page.getByRole('status').filter({ hasText: 'beyond this device’s 40-link view' }),
  ).toContainText('1 account save');
  await page
    .getByRole('button', { name: 'Remove Device-only Vimeo from queue', exact: true })
    .click();
  await expect(page.locator('.library-queue li')).toHaveCount(40);
  await expect(page.locator('.library-queue')).toContainText('Account save 39');
  await expect(
    page.getByRole('status').filter({ hasText: 'beyond this device’s 40-link view' }),
  ).toHaveCount(0);
});
