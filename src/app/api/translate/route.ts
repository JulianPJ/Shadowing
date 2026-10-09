import { handleTranslationRequest } from '@/lib/translation-api';
import { createDeepLTranslationProvider } from '@/lib/providers/translation';
import { publicLimit, workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  const limited = await publicLimit(request, 'translate');
  if (limited) return limited;
  const key = workerEnv.DEEPL_AUTH_KEY;
  // MyMemory remains the keyless local fallback when no DeepL secret is configured.
  return key
    ? handleTranslationRequest(request, createDeepLTranslationProvider(key))
    : handleTranslationRequest(request);
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
