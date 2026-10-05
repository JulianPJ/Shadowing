import { handleTranslationRequest } from '@/lib/translation-api';
import { createDeepLTranslationProvider } from '@/lib/providers/translation';
export const maxDuration = 20;
export async function POST(request: Request) {
  const authKey = process.env.DEEPL_AUTH_KEY;
  return authKey
    ? handleTranslationRequest(request, createDeepLTranslationProvider(authKey))
    : handleTranslationRequest(request);
}
