// @ts-check
import vinextHandler from 'vinext/server/fetch-handler';
import { serveDemoAsset } from './src/lib/demo-asset';
import { refreshCatalog } from './src/lib/discover/refresh';
import { enrichDiscoveryCatalogue } from './src/lib/discover/enrich';
import { createYoutubeCaptions } from './src/lib/providers/transcription';
import { createWorkersAiDifficultyProvider } from './src/lib/providers/difficulty';
export * from 'vinext/server/fetch-handler';

// API routes live in src/app/api and read bindings from `cloudflare:workers`.
// This entry only adds what a route handler cannot: byte-range assets and the cron trigger.
// Preserve vinext's response-stage exports above.
/** @typedef {import('cf/config').InferEnv<typeof import('./cloudflare.config').worker>} WorkerEnv */

const worker = {
  /**
   * @param {Request} request
   * @param {WorkerEnv} env
   * @param {Parameters<typeof vinextHandler.fetch>[2]} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Keep old shared links usable; auth and account sync require the canonical origin.
    if (
      url.hostname === 'shadowing.julianpopovskijones.workers.dev' &&
      ['GET', 'HEAD'].includes(request.method)
    ) {
      url.protocol = 'https:';
      url.hostname = 'hibikiapp.net';
      return Response.redirect(url.toString(), 307);
    }
    if (url.pathname === '/demo.mp4' && ['GET', 'HEAD'].includes(request.method))
      return serveDemoAsset(request, (source) => env.ASSETS.fetch(source));
    if (url.pathname === '/discover' && String(env.DISCOVER_ENABLED) === 'false')
      return Response.json(
        { error: 'Discover is unavailable.' },
        { status: 404, headers: { 'Cache-Control': 'no-store' } },
      );
    return vinextHandler.fetch(request, env, ctx);
  },
  /**
   * @param {import('@cloudflare/workers-types').ScheduledController} controller
   * @param {WorkerEnv} env
   * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
   */
  scheduled(controller, env, ctx) {
    if (env.HIBIKI_DB)
      ctx.waitUntil(
        (async () => {
          // Keep metadata acquisition and D1 verification ahead of optional enrichment.
          await refreshCatalog(env.HIBIKI_DB, env.YOUTUBE_DATA_API_KEY, fetch, controller.scheduledTime);
          // Explicit deployment opt-in: never infer on feed reads or during a normal rollout.
          if (
            String(env.DISCOVER_ENABLED) !== 'false' &&
            String(env.DISCOVER_ENRICHMENT_ENABLED) === 'true'
          )
            await enrichDiscoveryCatalogue(
              env.HIBIKI_DB,
              createYoutubeCaptions(env.YOUTUBE_CAPTION_RELAY_URL, env.YOUTUBE_CAPTION_RELAY_TOKEN),
              createWorkersAiDifficultyProvider(env.AI),
              controller.scheduledTime,
            );
        })(),
      );
  },
};
export default worker;
