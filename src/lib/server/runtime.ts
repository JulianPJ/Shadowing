// Server-only Cloudflare runtime glue shared by the API route handlers.
// Route handlers stay thin: bindings, auth and limits live here; domain logic stays in src/lib.
import { env, waitUntil } from 'cloudflare:workers';
import { createAuth } from '../auth/server';
import { createD1AccessRepository, requirePro } from '../access';
import { accountHandler } from '../sync/server';
import { createD1UserProgressRepository } from '../sync/repository';
import { createD1DictionaryRepository } from '../dictionary/repository';
import { createD1ReviewRepository } from '../review/repository';
import { D1KnowledgeRepository } from '../knowledge/repository';
import { createD1LinkedTranscriptRepository, linkedTranscripts } from '../linked-transcripts';
import { createD1GeneratedArtifactRepository, generatedArtifacts } from '../generated-artifacts';
import { readCatalog } from '../discover/catalog';
import { createWorkersAiShadowingProvider } from '../providers/shadowing';
import { InferenceDenied, cachedRead, rateLimited, tooManyRequests } from './rate-limit';

export { env as workerEnv, waitUntil };

const noStore = { 'Cache-Control': 'no-store' };

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { ...noStore, ...headers } });
}

export function accountsConfigured() {
  return !!(env.HIBIKI_DB && env.AUTH_SECRET && env.AUTH_BASE_URL);
}

export function hibikiAuth() {
  return createAuth(env.HIBIKI_DB, env, waitUntil);
}

export function sharedStorage() {
  return env.HIBIKI_DB
    ? {
        transcripts: createD1LinkedTranscriptRepository(env.HIBIKI_DB),
        artifacts: createD1GeneratedArtifactRepository(env.HIBIKI_DB),
      }
    : { transcripts: linkedTranscripts, artifacts: generatedArtifacts };
}

/** Public routes that spend provider quota without an account. */
export async function publicLimit(request: Request, route: 'prepare' | 'translate') {
  return (await rateLimited(env.PUBLIC_API_RATE_LIMIT, request, { failClosed: false, route }))
    ? tooManyRequests('Too many requests. Wait a moment and try again.')
    : null;
}

/** Workers AI calls are bounded per route and client and fail closed. */
export type InferenceRoute =
  | 'transcribe'
  | 'difficulty'
  | 'quiz'
  | 'shadowing-feedback'
  | 'shadowing-summary'
  | 'shadowing-transcribe';
export async function inferenceLimit(request: Request, route: InferenceRoute, error: string) {
  return (await rateLimited(env.SHADOWING_AI_RATE_LIMIT, request, { failClosed: true, route }))
    ? tooManyRequests(error)
    : null;
}
/**
 * Spends the inference budget only when the provider is actually called: the authored demo and
 * shared-cache hits never reach it, so browsing analysed lessons cannot exhaust the limit.
 */
export function limitedInference<P extends object>(
  request: Request,
  route: InferenceRoute,
  error: string,
  provider: P,
): P {
  return new Proxy(provider, {
    get(target, key, receiver) {
      const value: unknown = Reflect.get(target, key, receiver);
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        const denied = await inferenceLimit(request, route, error);
        if (denied) throw new InferenceDenied(denied);
        return value.apply(target, args);
      };
    },
  });
}

export async function requireProAccess(request: Request) {
  if (!accountsConfigured()) return json({ error: 'Accounts are awaiting configuration.' }, 503);
  return requirePro(request, hibikiAuth(), createD1AccessRepository(env.HIBIKI_DB));
}

/** Authenticated account, sync, vocabulary and Watch Later routes. */
export async function accountRoute(request: Request) {
  if (!accountsConfigured())
    return new URL(request.url).pathname === '/api/account/me'
      ? json({ user: null, googleEnabled: false, emailEnabled: false })
      : json({ error: 'Accounts are awaiting configuration.' }, 503);
  try {
    const db = env.HIBIKI_DB;
    return await accountHandler({
      auth: hibikiAuth(),
      progress: createD1UserProgressRepository(db),
      env,
      db,
      dictionary: createD1DictionaryRepository(db),
      access: createD1AccessRepository(db),
      review: createD1ReviewRepository(db),
      knowledge: new D1KnowledgeRepository(db),
    })(request);
  } catch {
    return json({ error: 'Account service temporarily unavailable.' }, 503);
  }
}

export function discoverEnabled() {
  return String(env.DISCOVER_ENABLED) !== 'false';
}

/** Discover/Watch Later share one per-client budget. */
export async function discoveryLimit(request: Request) {
  if (await rateLimited(env.DISCOVERY_RATE_LIMIT, request, { failClosed: true }))
    return json({ error: 'Too many Discover requests. Try again shortly.' }, 429, {
      'Retry-After': '60',
    });
  return null;
}

export function discoverDisabled() {
  return json({ error: 'Discover is unavailable.' }, 404);
}

/** Discover account routes: feature flag, shared Discover budget, then the account handler. */
export async function discoverAccountRoute(request: Request) {
  if (!discoverEnabled()) return discoverDisabled();
  return (await discoveryLimit(request)) ?? accountRoute(request);
}

/** Watch Later remains available when the Discover feed is rolled back. */
export async function watchLaterRoute(request: Request) {
  return (await discoveryLimit(request)) ?? accountRoute(request);
}

type ShadowingHandler = (
  request: Request,
  provider: ReturnType<typeof createWorkersAiShadowingProvider>,
) => Promise<Response>;

/** Pro Shadowing Match routes: entitlement, then the fail-closed inference limit. */
export function shadowingRoute(
  route: Extract<InferenceRoute, `shadowing-${string}`>,
  handler: ShadowingHandler,
) {
  return async (request: Request) => {
    const denied =
      (await requireProAccess(request)) ??
      (await inferenceLimit(
        request,
        route,
        'Too many shadowing analyses. Wait a moment and try again.',
      ));
    return denied ?? handler(request, createWorkersAiShadowingProvider(env.AI));
  };
}

// The catalogue changes only on the 15-minute refresh, so one isolate reuses it briefly
// instead of reading up to 1,000 rows for every feed page.
const catalog = cachedRead(() => readCatalog(env.HIBIKI_DB), 60_000);
export function cachedCatalog() {
  return catalog();
}
