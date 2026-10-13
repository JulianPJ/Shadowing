import { handleDifficultyRequest } from '@/lib/difficulty-api';
import { createWorkersAiDifficultyProvider } from '@/lib/providers/difficulty';
import { limitedInference, requireProAccess, sharedStorage, workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  const denied = await requireProAccess(request);
  if (denied) return denied;
  return handleDifficultyRequest(
    request,
    limitedInference(
      request,
      'difficulty',
      'Too many difficulty requests. Wait a moment and try again.',
      createWorkersAiDifficultyProvider(workerEnv.AI),
    ),
    sharedStorage(),
  );
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
