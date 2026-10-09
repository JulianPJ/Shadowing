export { accountRoute as GET, accountRoute as POST } from '@/lib/server/runtime';

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
