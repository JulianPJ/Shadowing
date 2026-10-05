// @ts-check
import vinextHandler from 'vinext/server/fetch-handler';
import { createAuth, handleAuthRequest } from './src/lib/auth/server';
import { accountHandler } from './src/lib/sync/server';
import { createD1UserProgressRepository } from './src/lib/sync/repository';
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
    if (
      url.pathname.startsWith('/api/auth/') ||
      url.pathname.startsWith('/api/account/') ||
      url.pathname.startsWith('/api/sync/')
    ) {
      if (!env.HIBIKI_DB || !env.AUTH_SECRET || !env.AUTH_BASE_URL) {
        return url.pathname === '/api/account/me'
          ? Response.json(
              { user: null, googleEnabled: false, emailEnabled: false },
              { headers: { 'Cache-Control': 'no-store' } },
            )
          : Response.json({ error: 'Accounts are awaiting configuration.' }, { status: 503 });
      }
      const auth = createAuth(env.HIBIKI_DB, env, (promise) => ctx.waitUntil(promise));
      try {
        return url.pathname.startsWith('/api/auth/')
          ? await handleAuthRequest(request, auth, env)
          : await accountHandler(
              auth,
              createD1UserProgressRepository(env.HIBIKI_DB),
              env,
              env.HIBIKI_DB,
            )(request);
      } catch {
        return Response.json(
          { error: 'Account service temporarily unavailable.' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
      }
    }
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
