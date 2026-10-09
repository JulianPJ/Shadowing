import { handleQuizRequest } from '@/lib/quiz-api';
import { createWorkersAiQuizProvider } from '@/lib/providers/quiz/workers';
import { inferenceLimit, requireProAccess, sharedStorage, workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  const denied =
    (await requireProAccess(request)) ??
    (await inferenceLimit(request, 'quiz', 'Too many quiz requests. Wait a moment and try again.'));
  if (denied) return denied;
  return handleQuizRequest(request, createWorkersAiQuizProvider(workerEnv.AI), sharedStorage());
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
