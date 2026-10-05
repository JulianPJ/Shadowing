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
    HIBIKI_DB: bindings.d1({ id: 'cf88fe7d-16bb-4f58-8839-2b27718a7847' }),
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
