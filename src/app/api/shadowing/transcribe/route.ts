import { handleShadowingTranscriptionRequest } from '@/lib/shadowing-api';
import { shadowingRoute } from '@/lib/server/runtime';

export const POST = shadowingRoute('shadowing-transcribe', handleShadowingTranscriptionRequest);

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
