import vinextHandler from 'vinext/server/fetch-handler';
import { serveDemoAsset } from './src/lib/demo-asset';
import { handleQuizRequest } from './src/lib/quiz-api.ts';
import { createWorkersAiQuizProvider } from './src/lib/providers/quiz.ts';
export * from 'vinext/server/fetch-handler';

// Preserve vinext's response-stage exports/cache integration; adapt only Cloudflare-specific runtime paths.
const worker = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/demo.mp4' && ['GET', 'HEAD'].includes(request.method)) {
      return serveDemoAsset(request, source => env.ASSETS.fetch(source));
    }

    if (url.pathname === '/api/quiz' && request.method === 'POST') {
      return handleQuizRequest(request, createWorkersAiQuizProvider(env.AI));
    }

    return vinextHandler.fetch(request, env, ctx);
  },
};
export default worker;
