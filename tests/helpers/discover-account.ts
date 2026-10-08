import type { BrowserContext, Page } from '@playwright/test';
import { DEFAULT_PREFERENCES, type Preferences } from '../../src/lib/discover/types';
import { mergeWatchRecords, type WatchRecord } from '../../src/lib/discover/watch-later';
/** Deterministic account boundaries for the existing browser suite; no provider requests. */
export async function mockDiscoverSync(target: BrowserContext | Page) {
  const queues = new Map<string, WatchRecord[]>(),
    preferences = new Map<string, Preferences>();
  await target.route('**/api/watch-later', async (route) => {
    const owner = route.request().headers()['x-hibiki-account'] ?? '';
    if (route.request().method() === 'POST')
      queues.set(
        owner,
        mergeWatchRecords(queues.get(owner) ?? [], route.request().postDataJSON().records),
      );
    await route.fulfill({ json: { records: queues.get(owner) ?? [] } });
  });
  await target.route('**/api/discover/preferences', async (route) => {
    const owner = route.request().headers()['x-hibiki-account'] ?? '';
    if (route.request().method() === 'PATCH')
      preferences.set(owner, route.request().postDataJSON());
    await route.fulfill({ json: { preferences: preferences.get(owner) ?? DEFAULT_PREFERENCES } });
  });
  await target.route('**/api/discover/feedback', (route) =>
    route.fulfill({ json: { feedback: [] } }),
  );
  await target.route('**/api/discover/events', (route) => route.fulfill({ json: { ok: true } }));
}
