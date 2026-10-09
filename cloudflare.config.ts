import { bindings, defineConfig, defineWorker, triggers } from 'cf/config';
import { createWorkersCacheConfig } from '@vinext/cloudflare/cache/config';

const cache = await createWorkersCacheConfig();

export const worker = defineWorker({
  ...cache,
  name: 'shadowing',
  // Keep the Cloudflare Dashboard custom domain in source control for strict deploys.
  domains: ['hibikiapp.net'],
  // Keep legacy shared links and version previews available alongside the custom domain.
  workersDev: true,
  previewUrls: true,
  entrypoint: './cloudflare-worker.js',
  compatibilityDate: '2026-10-03',
  // Public routing is required when fetching the relay's workers.dev endpoint.
  compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
  assets: { notFoundHandling: 'none', runWorkerFirst: ['/demo.mp4'] },
  triggers: [triggers.scheduled({ schedule: '*/15 * * * *' })],
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
    DISCOVER_ENABLED: bindings.text('true'),
    DISCOVERY_RATE_LIMIT: bindings.rateLimit({
      namespace: '19002',
      simple: { limit: 90, period: 60 },
    }),
    // Public, unauthenticated routes that spend provider quota (translation, caption relay).
    PUBLIC_API_RATE_LIMIT: bindings.rateLimit({
      namespace: '19003',
      simple: { limit: 60, period: 60 },
    }),
    YOUTUBE_DATA_API_KEY: bindings.secret(),
    // Better Auth must have one canonical production origin for trusted callbacks and secure cookies.
    AUTH_BASE_URL: bindings.text('https://hibikiapp.net/'),
    AUTH_SECRET: bindings.secret(),
    GOOGLE_CLIENT_ID: bindings.secret(),
    GOOGLE_CLIENT_SECRET: bindings.secret(),
    RESEND_API_KEY: bindings.secret(),
    AUTH_EMAIL_FROM: bindings.text('Hibiki <accounts@hibikiapp.net>'),
    DEEPL_AUTH_KEY: bindings.secret(),
    YOUTUBE_CAPTION_RELAY_URL: bindings.secret(),
    YOUTUBE_CAPTION_RELAY_TOKEN: bindings.secret(),
  },
  observability: { enabled: true },
});

export default defineConfig({ worker });
