import vinextHandler from 'vinext/server/fetch-handler';
import { serveDemoAsset } from './src/lib/demo-asset';
export * from 'vinext/server/fetch-handler';

// Preserve vinext's response-stage exports/cache integration; adapt only the bundled demo.
const worker = {
  async fetch(request, env, ctx) {
    if (new URL(request.url).pathname === '/demo.mp4' && ['GET', 'HEAD'].includes(request.method)) {
      return serveDemoAsset(request, source => env.ASSETS.fetch(source));
    }
    return vinextHandler.fetch(request, env, ctx);
  },
};
export default worker;
