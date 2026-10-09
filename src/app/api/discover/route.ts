import { handleFeedRequest } from '@/lib/discover/server';
import {
  cachedCatalog,
  discoverDisabled,
  discoverEnabled,
  discoveryLimit,
  workerEnv,
} from '@/lib/server/runtime';

async function feed(request: Request) {
  if (!discoverEnabled()) return discoverDisabled();
  const limited = await discoveryLimit(request);
  if (limited) return limited;
  const rawRegion = request.headers.get('cf-ipcountry');
  const region = rawRegion && /^[A-Z]{2}$/.test(rawRegion) ? rawRegion : 'JP';
  return handleFeedRequest(request, workerEnv.HIBIKI_DB, region, () => cachedCatalog());
}
export const GET = feed;
export const POST = feed;

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
