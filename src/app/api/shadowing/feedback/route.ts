import { handleShadowingFeedbackRequest } from '@/lib/shadowing-api';
import { shadowingRoute } from '@/lib/server/runtime';

export const POST = shadowingRoute('shadowing-feedback', handleShadowingFeedbackRequest);

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
