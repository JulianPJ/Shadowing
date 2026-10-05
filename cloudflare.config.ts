import { bindings, defineConfig, defineWorker } from 'cf/config';
import { createWorkersCacheConfig } from '@vinext/cloudflare/cache/config';

const cache = await createWorkersCacheConfig();

export const worker = defineWorker({
  ...cache,
  name: 'shadowing',
  entrypoint: './cloudflare-worker.js',
  compatibilityDate: '2026-10-03',
  // Public routing is required when fetching the relay's workers.dev endpoint.
  compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  assets: { notFoundHandling: 'none', runWorkerFirst: ['/demo.mp4'] },
  env: {
    ...cache.env,
    ASSETS: bindings.assets(),
    IMAGES: bindings.images(),
    AI: bindings.ai(),
    SHADOWING_AI_RATE_LIMIT: bindings.rateLimit({
      namespace: '19001',
      simple: { limit: 6, period: 60 },
    }),
    HIBIKI_DB: bindings.d1({ id: 'cf88fe7d-16bb-4f58-8839-2b27718a7847' }),
    // Better Auth must have one canonical production origin for trusted callbacks and secure cookies.
    AUTH_BASE_URL: bindings.text('https://shadowing.julianpopovskijones.workers.dev'),
    AUTH_SECRET: bindings.secret(),
    GOOGLE_CLIENT_ID: bindings.secret(),
    GOOGLE_CLIENT_SECRET: bindings.secret(),
    DEEPL_AUTH_KEY: bindings.secret(),
    YOUTUBE_CAPTION_RELAY_URL: bindings.secret(),
    YOUTUBE_CAPTION_RELAY_TOKEN: bindings.secret(),
  },
  observability: { enabled: true },
});

export default defineConfig({ worker });
