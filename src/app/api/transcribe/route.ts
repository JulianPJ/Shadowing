import { handleTranscriptionRequest } from '@/lib/transcription-api';
import { createWorkersAiTranscriptionProvider } from '@/lib/providers/ai-transcription';
import { inferenceLimit, requireProAccess, workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  const denied =
    (await requireProAccess(request)) ??
    (await inferenceLimit(
      request,
      'transcribe',
      'Too many subtitle requests. Wait a moment and try again.',
    ));
  if (denied) return denied;
  return handleTranscriptionRequest(request, createWorkersAiTranscriptionProvider(workerEnv.AI));
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
