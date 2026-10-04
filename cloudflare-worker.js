// @ts-check
import vinextHandler from 'vinext/server/fetch-handler';
import { serveDemoAsset } from './src/lib/demo-asset';
import { handleQuizRequest } from './src/lib/quiz-api';
import { createWorkersAiQuizProvider } from './src/lib/providers/quiz';
import { handleDifficultyRequest } from './src/lib/difficulty-api';
import { createWorkersAiDifficultyProvider } from './src/lib/providers/difficulty';
import { handleTranslationRequest } from './src/lib/translation-api';
import { createDeepLTranslationProvider } from './src/lib/providers/translation';
import { createPrepareHandler } from './src/lib/prepare';
import { createYoutubeCaptions } from './src/lib/providers/transcription';
import {
  createD1LinkedTranscriptRepository,
  linkedTranscripts,
} from './src/lib/linked-transcripts';
import {
  createD1GeneratedArtifactRepository,
  generatedArtifacts,
} from './src/lib/generated-artifacts';
export * from 'vinext/server/fetch-handler';

// Preserve vinext's response-stage exports/cache integration; adapt only Cloudflare-specific runtime paths.
/** @typedef {import('cf/config').InferEnv<typeof import('./cloudflare.config').worker>} WorkerEnv */
const worker = {
  /**
   * @param {Request} request
   * @param {WorkerEnv} env
   * @param {Parameters<typeof vinextHandler.fetch>[2]} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const storage = {
      transcripts: env.HIBIKI_DB
        ? createD1LinkedTranscriptRepository(env.HIBIKI_DB)
        : linkedTranscripts,
      artifacts: env.HIBIKI_DB
        ? createD1GeneratedArtifactRepository(env.HIBIKI_DB)
        : generatedArtifacts,
    };
    if (url.pathname === '/api/prepare' && request.method === 'POST') {
      return createPrepareHandler({
        captions: createYoutubeCaptions(
          env.YOUTUBE_CAPTION_RELAY_URL,
          env.YOUTUBE_CAPTION_RELAY_TOKEN,
        ),
        repository: storage.transcripts,
      })(request);
    }

    if (url.pathname === '/demo.mp4' && ['GET', 'HEAD'].includes(request.method)) {
      return serveDemoAsset(request, (source) => env.ASSETS.fetch(source));
    }

    if (url.pathname === '/api/quiz' && request.method === 'POST') {
      return handleQuizRequest(request, createWorkersAiQuizProvider(env.AI), storage);
    }

    if (url.pathname === '/api/difficulty' && request.method === 'POST') {
      return handleDifficultyRequest(request, createWorkersAiDifficultyProvider(env.AI), storage);
    }

    if (url.pathname === '/api/translate' && request.method === 'POST') {
      return handleTranslationRequest(request, createDeepLTranslationProvider(env.DEEPL_AUTH_KEY));
    }

    return vinextHandler.fetch(request, env, ctx);
  },
};
export default worker;
