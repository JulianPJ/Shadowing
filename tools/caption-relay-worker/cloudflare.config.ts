import { bindings, defineConfig, defineWorker, exports } from 'cf/config';

export const worker = defineWorker({
  name: 'shadowing-caption-relay',
  entrypoint: './worker.ts',
  compatibilityDate: '2026-10-03',
  compatibilityFlags: ['nodejs_compat'],
  exports: { CaptionRelay: exports.durableObject({ storage: 'sqlite' }) },
  env: {
    CAPTION_RELAY: bindings.durableObject({
      worker: 'shadowing-caption-relay',
      exportName: 'CaptionRelay',
    }),
    YOUTUBE_CAPTION_RELAY_TOKEN: bindings.secret(),
  },
  observability: { enabled: true },
});

export default defineConfig({ worker });
