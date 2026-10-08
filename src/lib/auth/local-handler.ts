import { localAuth } from './local';
import { authEnvironment } from './server';
import { accountHandler } from '../sync/server';
import { requirePro } from '../access';
export async function localAccountHandler(request: Request) {
  const services = await localAuth();
  if (!services)
    return new URL(request.url).pathname === '/api/account/me'
      ? Response.json(
          { user: null, googleEnabled: false, emailEnabled: false },
          { headers: { 'Cache-Control': 'no-store' } },
        )
      : Response.json({ error: 'Sign in required' }, { status: 401 });
  return accountHandler(
    services.auth,
    services.repository,
    authEnvironment(),
    undefined,
    services.dictionary,
    services.access,
    services.review,
    services.tags,
    services.knowledge,
    services.database,
  )(request);
}

export async function localRequirePro(request: Request) {
  const services = await localAuth();
  if (!services)
    return Response.json(
      { code: 'sign-in-required', error: 'Sign in to use Hibiki Pro features.' },
      { status: 401, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } },
    );
  return requirePro(request, services.auth, services.access);
}
