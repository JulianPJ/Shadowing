import { readBoundedText, BodyLimitError } from '../http-body';
import { storageEvent } from '../d1';
import { EMPTY_CONTEXT, type Database } from './types';
import { normalizeFilters, validateContext } from './validation';
import { readCatalog } from './catalog';
import { buildFeed } from './rank';
export async function handleFeedRequest(request: Request, db?: Database, region = 'JP') {
  const privateRead = request.method === 'POST';
  const headers = {
    'Cache-Control': privateRead ? 'no-store' : 'public, max-age=60',
    Vary: 'CF-IPCountry',
  };
  try {
    if (!['GET', 'POST'].includes(request.method))
      return Response.json(
        { error: 'Method not supported' },
        { status: 405, headers: { Allow: 'GET, POST' } },
      );
    if (
      privateRead &&
      (request.headers.get('origin') !== new URL(request.url).origin ||
        request.headers.get('content-type')?.split(';')[0] !== 'application/json')
    )
      return Response.json(
        { error: 'Invalid origin or content type' },
        { status: 403, headers: { 'Cache-Control': 'no-store' } },
      );
    const input = privateRead ? JSON.parse(await readBoundedText(request, 16384)) : {};
    const url = new URL(request.url);
    const filters = normalizeFilters(privateRead ? input.filters : url.searchParams);
    const context = privateRead ? validateContext(input.context) : EMPTY_CONTEXT;
    const cursor = privateRead ? (input.cursor ?? null) : url.searchParams.get('cursor');
    if (cursor !== null && typeof cursor !== 'string') throw new Error('Invalid cursor');
    if (!db)
      return Response.json(
        {
          error: 'The discovery catalogue is awaiting configuration.',
          code: 'catalogue-unavailable',
        },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      );
    const started = performance.now();
    const videos = await readCatalog(db);
    const feed = await buildFeed(videos, filters, context, cursor, region);
    console.info(
      JSON.stringify({
        event: 'discover.feed',
        candidates: videos.length,
        eligible: feed.total,
        returned: feed.items.length,
        latencyMs: Math.round(performance.now() - started),
      }),
    );
    return Response.json(feed, { headers });
  } catch (error) {
    const invalid =
      error instanceof BodyLimitError ||
      error instanceof SyntaxError ||
      (error instanceof Error && /Invalid/.test(error.message));
    if (!invalid) storageEvent('discover.feed.unavailable');
    return Response.json(
      {
        error: invalid
          ? 'Invalid filters or expired page. Refresh the feed.'
          : 'Discovery is temporarily unavailable.',
        code: invalid ? 'invalid-query' : 'catalogue-unavailable',
      },
      {
        status: error instanceof BodyLimitError ? 413 : invalid ? 400 : 503,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
