import { bindings, defineConfig, defineWorker } from "cf/config";
import { createWorkersCacheConfig } from "@vinext/cloudflare/cache/config";

const cache = await createWorkersCacheConfig();

export default defineConfig({
  worker: defineWorker({
    ...cache,
    name: "shadowing",
    entrypoint: "./cloudflare-worker.js",
    compatibilityDate: "2026-10-03",
    // Public routing is required when fetching the relay's workers.dev endpoint.
    compatibilityFlags: ["nodejs_compat", "global_fetch_strictly_public"],
    assets: { notFoundHandling: "none", runWorkerFirst: ["/demo.mp4"] },
    env: {
      ...cache.env,
      ASSETS: bindings.assets(),
      IMAGES: bindings.images(),
      YOUTUBE_CAPTION_RELAY_URL: bindings.secret(),
      YOUTUBE_CAPTION_RELAY_TOKEN: bindings.secret(),
      QUIZ_API_URL: bindings.secret(),
      QUIZ_API_KEY: bindings.secret(),
      QUIZ_MODEL: bindings.secret(),
    },
    observability: { enabled: true },
  }),
});
