import { test, expect } from '@playwright/test';
import { buildFeed } from '../../src/lib/discover/rank';
import { normalizeFilters, validateContext } from '../../src/lib/discover/validation';
import { BANDS } from '../../src/lib/discover/types';
import { discoveryVideo } from '../helpers/discover';
import { mockProAccount } from '../helpers/pro-account';

// Larger than the 120-ID seen list, so the New discoveries lane always has unseen videos.
const videos = Array.from({ length: 600 }, (_, i) =>
  discoveryVideo(i, {
    band: BANDS[i % 6][0],
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
  }),
);

// Two tabs once synced each other forever: Discover rewrote its seen list on every load, the
// other tab answered every account-key write with a full learner sync, and that sync's writes
// rebuilt Discover's learner profile, which reloaded the feed.
test('two open tabs settle instead of re-syncing each other', async ({ context }) => {
  await mockProAccount(context);
  const counts = { bootstrap: 0, feed: 0, events: 0 };
  await context.route('**/api/discover', async (route) => {
    counts.feed++;
    const body = route.request().postDataJSON();
    await route.fulfill({
      json: await buildFeed(
        videos,
        normalizeFilters(body.filters),
        validateContext(body.context),
        body.cursor,
        'JP',
      ),
    });
  });
  await context.route('**/api/discover/events', (route) => {
    counts.events++;
    return route.fulfill({ json: { ok: true } });
  });
  await context.route('https://i.ytimg.com/**', (route) => route.abort());
  context.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/sync/bootstrap') counts.bootstrap++;
  });
  const discover = await context.newPage();
  await discover.goto('/discover?band=all');
  await expect(discover.locator('.discover-card')).not.toHaveCount(0);
  const home = await context.newPage();
  await home.goto('/');
  await home.waitForTimeout(5000);
  const settled = { ...counts };
  await home.waitForTimeout(10000);
  expect(counts.bootstrap - settled.bootstrap).toBeLessThanOrEqual(2);
  expect(counts.feed - settled.feed).toBeLessThanOrEqual(1);
  expect(counts.events - settled.events).toBeLessThanOrEqual(1);
});
