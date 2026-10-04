import { handleTranslationRequest } from '@/lib/translation-api';
export const maxDuration = 20;
export async function POST(request: Request) {
  return handleTranslationRequest(request);
}
