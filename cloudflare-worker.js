// @ts-check
import vinextHandler from 'vinext/server/fetch-handler';
import { createAuth, handleAuthRequest } from './src/lib/auth/server';
import { accountHandler } from './src/lib/sync/server';
import { createD1UserProgressRepository } from './src/lib/sync/repository';
import { createD1DictionaryRepository } from './src/lib/dictionary/repository';
import { createD1ReviewRepository } from './src/lib/review/repository';
import { createD1TagRepository } from './src/lib/tags/repository';
import { D1KnowledgeRepository } from './src/lib/knowledge/repository';
import { createD1AccessRepository, requirePro } from './src/lib/access';
import { serveDemoAsset } from './src/lib/demo-asset';
import { handleDiscoveryRequest } from './src/lib/discovery-api';
import { handleFeedRequest } from './src/lib/discover/server';
import { refreshCatalog } from './src/lib/discover/refresh';
import { recordPreparationState } from './src/lib/discover/preparation-state';
import { handleQuizRequest } from './src/lib/quiz-api';
import { createWorkersAiQuizProvider } from './src/lib/providers/quiz';
import { handleDifficultyRequest } from './src/lib/difficulty-api';
import { createWorkersAiDifficultyProvider } from './src/lib/providers/difficulty';
import { handleTranslationRequest } from './src/lib/translation-api';
import { createDeepLTranslationProvider } from './src/lib/providers/translation';
import { createPrepareHandler } from './src/lib/prepare';
import { createYoutubeCaptions } from './src/lib/providers/transcription';
import { createWorkersAiTranscriptionProvider } from './src/lib/providers/ai-transcription';
import { handleTranscriptionRequest } from './src/lib/transcription-api';
import { createWorkersAiShadowingProvider } from './src/lib/providers/shadowing';
import {
  handleShadowingTranscriptionRequest,
  handleShadowingFeedbackRequest,
  handleShadowingSummaryRequest,
} from './src/lib/shadowing-api';
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
/** @typedef {import('cf/config').InferEnv<typeof import('./cloudflare.config').worker> & import('./src/lib/auth/server').AuthEnvironment} WorkerEnv */
/**
 * @param {Request} request
 * @param {WorkerEnv} env
 */
async function shadowingRateLimited(request, env) {
  const route = new URL(request.url).pathname;
  const client = request.headers.get('cf-connecting-ip') || 'unknown';
  try {
    const result = await env.SHADOWING_AI_RATE_LIMIT.limit({ key: `${route}:${client}` });
    return !result.success;
  } catch {
    // Fail closed: an unavailable limiter must not turn into unbounded paid AI usage.
    return true;
  }
}

function shadowingRateLimitResponse(
  error = 'Too many shadowing analyses. Wait a moment and try again.',
) {
  return Response.json(
    { code: 'rate-limited', error },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  );
}

/**
 * @param {Request} request
 * @param {WorkerEnv} env
 * @param {Parameters<typeof vinextHandler.fetch>[2]} ctx
 */
async function requireProAccess(request, env, ctx) {
  if (!env.HIBIKI_DB || !env.AUTH_SECRET || !env.AUTH_BASE_URL)
    return Response.json(
      { error: 'Accounts are awaiting configuration.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  const auth = createAuth(env.HIBIKI_DB, env, (promise) => ctx.waitUntil(promise));
  return requirePro(request, auth, createD1AccessRepository(env.HIBIKI_DB));
}

const worker = {
  /**
   * @param {Request} request
   * @param {WorkerEnv} env
   * @param {Parameters<typeof vinextHandler.fetch>[2]} ctx
   */
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const discoveryApi =
      url.pathname === '/api/discover' || url.pathname.startsWith('/api/discover/');
    if (url.pathname === '/discover' || discoveryApi) {
      if (String(env.DISCOVER_ENABLED) === 'false')
        return Response.json(
          { error: 'Discover is unavailable.' },
          { status: 404, headers: { 'Cache-Control': 'no-store' } },
        );
    }
    if (discoveryApi || url.pathname.startsWith('/api/watch-later')) {
      try {
        const limited = await env.DISCOVERY_RATE_LIMIT.limit({
          key: request.headers.get('cf-connecting-ip') || 'unknown',
        });
        if (!limited.success)
          return Response.json(
            { error: 'Too many Discover requests. Try again shortly.' },
            { status: 429, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } },
          );
      } catch {
        return Response.json(
          { error: 'Discover is temporarily unavailable.' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        );
      }
    }
    if (url.pathname === '/api/discover') {
      const rawRegion = request.headers.get('cf-ipcountry');
      const region = rawRegion && /^[A-Z]{2}$/.test(rawRegion) ? rawRegion : 'JP';
      if (request.method === 'GET') {
        const keyUrl = new URL(request.url);
        keyUrl.searchParams.set('__region', region);
        const key = new Request(keyUrl, { method: 'GET' });
        const cache = await caches.open('hibiki-discover');
        const cached = await cache.match(key);
        if (cached) return cached;
        const response = await handleFeedRequest(request, env.HIBIKI_DB, region);
        if (response.ok) ctx.waitUntil(cache.put(key, response.clone()));
        return response;
      }
      return handleFeedRequest(request, env.HIBIKI_DB, region);
    }
    if (url.pathname === '/api/discovery') {
      return handleDiscoveryRequest(request, env.HIBIKI_DB);
    }
    if (
      url.pathname.startsWith('/api/auth/') ||
      url.pathname.startsWith('/api/account/') ||
      url.pathname.startsWith('/api/sync/') ||
      url.pathname === '/api/dictionary' ||
      url.pathname === '/api/review' ||
      url.pathname === '/api/tags' ||
      url.pathname === '/api/knowledge' ||
      url.pathname.startsWith('/api/discover/') ||
      url.pathname.startsWith('/api/watch-later')
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
              createD1DictionaryRepository(env.HIBIKI_DB),
              createD1AccessRepository(env.HIBIKI_DB),
              createD1ReviewRepository(env.HIBIKI_DB),
              createD1TagRepository(env.HIBIKI_DB),
              new D1KnowledgeRepository(env.HIBIKI_DB),
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
        onOutcome: env.HIBIKI_DB
          ? (videoId, code) => recordPreparationState(env.HIBIKI_DB, videoId, code)
          : undefined,
      })(request);
    }

    if (url.pathname === '/api/transcribe' && request.method === 'POST') {
      const denied = await requireProAccess(request, env, ctx);
      if (denied) return denied;
      if (await shadowingRateLimited(request, env))
        return shadowingRateLimitResponse(
          'Too many subtitle requests. Wait a moment and try again.',
        );
      return handleTranscriptionRequest(request, createWorkersAiTranscriptionProvider(env.AI));
    }

    if (url.pathname.startsWith('/api/shadowing/') && request.method === 'POST') {
      const denied = await requireProAccess(request, env, ctx);
      if (denied) return denied;
      if (await shadowingRateLimited(request, env)) return shadowingRateLimitResponse();
      const provider = createWorkersAiShadowingProvider(env.AI);
      if (url.pathname === '/api/shadowing/transcribe')
        return handleShadowingTranscriptionRequest(request, provider);
      if (url.pathname === '/api/shadowing/feedback')
        return handleShadowingFeedbackRequest(request, provider);
      if (url.pathname === '/api/shadowing/summary')
        return handleShadowingSummaryRequest(request, provider);
    }

    if (url.pathname === '/demo.mp4' && ['GET', 'HEAD'].includes(request.method)) {
      return serveDemoAsset(request, (source) => env.ASSETS.fetch(source));
    }

    if (url.pathname === '/api/quiz' && request.method === 'POST') {
      const denied = await requireProAccess(request, env, ctx);
      if (denied) return denied;
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
  /**
   * @param {import('@cloudflare/workers-types').ScheduledController} controller
   * @param {WorkerEnv} env
   * @param {import('@cloudflare/workers-types').ExecutionContext} ctx
   */
  scheduled(controller, env, ctx) {
    if (env.HIBIKI_DB)
      ctx.waitUntil(
        refreshCatalog(env.HIBIKI_DB, env.YOUTUBE_DATA_API_KEY, fetch, controller.scheduledTime),
      );
  },
};
export default worker;
