import { defineConfig } from 'vite';
import vinext from 'vinext';
import { cloudflare } from '@cloudflare/vite-plugin';
import { workersCacheCdnAdapter } from '@vinext/cloudflare/cache/workers-cache-cdn-adapter';
import { imagesOptimizer } from '@vinext/cloudflare/images/images-optimizer';
import path from 'node:path';

// Test the built Worker without remote bindings, inference or production state.
export default defineConfig({
  root: process.cwd(),
  plugins: [
    vinext({ cache: { cdn: workersCacheCdnAdapter() }, images: { optimizer: imagesOptimizer() } }),
    cloudflare({
      remoteBindings: false,
      persistState: false,
      types: { generate: false },
      viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
    }),
  ],
  resolve: { alias: { sharp: path.resolve(process.cwd(), 'empty-stub.js') } },
});
