import { handleAuthRequest } from '@/lib/auth/server';
import { accountsConfigured, hibikiAuth, json, workerEnv } from '@/lib/server/runtime';

async function handle(request: Request) {
  if (!accountsConfigured()) return json({ error: 'Accounts are awaiting configuration.' }, 503);
  try {
    return await handleAuthRequest(request, hibikiAuth(), workerEnv);
  } catch {
    return json({ error: 'Account service temporarily unavailable.' }, 503);
  }
}
export const GET = handle;
export const POST = handle;

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
