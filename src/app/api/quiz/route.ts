import { handleQuizRequest } from '@/lib/quiz-api';
import { createWorkersAiQuizProvider } from '@/lib/providers/quiz/workers';
import { limitedInference, requireProAccess, sharedStorage, workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  const denied = await requireProAccess(request);
  if (denied) return denied;
  return handleQuizRequest(
    request,
    limitedInference(
      request,
      'quiz',
      'Too many quiz requests. Wait a moment and try again.',
      createWorkersAiQuizProvider(workerEnv.AI),
    ),
    sharedStorage(),
  );
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
