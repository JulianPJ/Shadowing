import { localAuth } from '@/lib/auth/local';
import { handleAuthRequest, authEnvironment } from '@/lib/auth/server';
async function handle(request: Request) {
  const auth = await localAuth();
  return auth
    ? handleAuthRequest(request, auth.auth, authEnvironment())
    : Response.json({ error: 'Accounts are not configured on this server.' }, { status: 503 });
}
export const GET = handle;
export const POST = handle;
