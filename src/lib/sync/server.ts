import type { AuthEnvironment, HibikiAuth } from '../auth/server';
import { readBoundedText, BodyLimitError } from '../http-body';
import type { D1Database } from '../d1';
import type { UserProgressRepository } from './types';
import { validateSync } from './validation';
import { verifyAttempt } from './quiz-verification';
import { restorePublicLesson } from './restore-lesson';
import type { DictionaryRepository } from '../dictionary/types';
import { handleDictionaryRequest } from '../dictionary/server';

export function accountHandler(
  auth: HibikiAuth,
  repository: UserProgressRepository,
  env: AuthEnvironment,
  db?: D1Database,
  dictionary?: DictionaryRepository,
) {
  return async (request: Request): Promise<Response> => {
    const headers = { 'Cache-Control': 'no-store', Vary: 'Cookie' };
    const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
    try {
      const url = new URL(request.url);
      if (url.origin !== new URL(env.AUTH_BASE_URL!).origin)
        return respond({ error: 'Invalid origin' }, 403);
      if (
        request.method === 'POST' &&
        (request.headers.get('origin') !== url.origin ||
          request.headers.get('content-type')?.split(';')[0] !== 'application/json')
      )
        return respond({ error: 'Invalid origin or content type' }, 403);
      const session = await auth.api.getSession({ headers: request.headers });
      if (url.pathname === '/api/account/me' && request.method === 'GET') {
        return respond({
          user: session
            ? {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
                emailVerified: session.user.emailVerified,
              }
            : null,
          googleEnabled: !!env.GOOGLE_CLIENT_ID && !!env.GOOGLE_CLIENT_SECRET,
          emailEnabled: !!env.RESEND_API_KEY && !!env.AUTH_EMAIL_FROM,
        });
      }
      if (!session) return respond({ error: 'Sign in required' }, 401);
      const userId = session.user.id;
      // Cookies are shared between tabs. A stale tab must not upload the old account's cache.
      const expectedAccount = request.headers.get('X-Hibiki-Account');
      if (expectedAccount && expectedAccount !== userId)
        return respond({ error: 'Account changed. Refresh your session.' }, 409);
      if (url.pathname === '/api/dictionary') {
        if (!dictionary) return respond({ error: 'Dictionary storage unavailable' }, 503);
        return handleDictionaryRequest(request, userId, session.user.emailVerified, dictionary);
      }
      if (url.pathname === '/api/sync/lesson' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!id || id.length > 1000) return respond({ error: 'Invalid lesson identity' }, 400);
        const reference = await repository.lesson(userId, id);
        const lesson = reference ? await restorePublicLesson(reference, db) : null;
        return lesson
          ? respond({ lesson })
          : respond({ error: 'Reattach media and transcript on this device to resume.' }, 404);
      }
      if (url.pathname === '/api/sync/bootstrap' && request.method === 'GET') {
        return respond(await repository.bootstrap(userId, url.searchParams.get('cursor')));
      }
      if (url.pathname === '/api/sync/push' && request.method === 'POST') {
        if (!session.user.emailVerified) return respond({ error: 'Verify your email first' }, 403);
        const data = validateSync(JSON.parse(await readBoundedText(request, 512_000)));
        for (let i = 0; i < data.attempts.length; i++)
          data.attempts[i] = await verifyAttempt({ ...data.attempts[i], verified: false }, db);
        await repository.push(userId, data);
        return respond({ ok: true });
      }
      return respond({ error: 'Method or route not supported' }, 405);
    } catch (error) {
      if (error instanceof BodyLimitError) return respond({ error: 'Sync batch too large' }, 413);
      if (
        error instanceof SyntaxError ||
        (error instanceof Error &&
          /Invalid|Unexpected|Immutable|Future|Unsafe|Batch|Media/.test(error.message))
      )
        return respond({ error: 'Invalid sync record' }, 400);
      // No exception text (which may contain user data or credentials) is logged.
      return respond({ error: 'Account sync temporarily unavailable' }, 503);
    }
  };
}
