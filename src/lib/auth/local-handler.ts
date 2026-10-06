import { localAuth } from './local';
import { authEnvironment } from './server';
import { accountHandler } from '../sync/server';
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
  )(request);
}
