import { myMemoryTranslation } from './providers/translation';
import type { TranslationProvider } from './types';

const cache = new Map<string, string>();

export async function handleTranslationRequest(request: Request, provider: TranslationProvider = myMemoryTranslation) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Open translation from your lesson.' }, { status: 403, headers });
  try {
    const raw = await request.text();
    if (raw.length > 5000) return Response.json({ error: 'This section is too long to translate.' }, { status: 400, headers });
    const body = JSON.parse(raw);
    const japanese = body.japanese;
    const previousJapanese = body.previousJapanese;
    const nextJapanese = body.nextJapanese;
    if (typeof japanese !== 'string' || !japanese.trim() || japanese.length > 1200) return Response.json({ error: 'A Japanese sentence is required (up to 1,200 characters).' }, { status: 400, headers });
    if ((previousJapanese !== undefined && (typeof previousJapanese !== 'string' || previousJapanese.length > 1200)) || (nextJapanese !== undefined && (typeof nextJapanese !== 'string' || nextJapanese.length > 1200))) {
      return Response.json({ error: 'Translation context must contain Japanese sections up to 1,200 characters each.' }, { status: 400, headers });
    }
    const context = {
      ...(typeof previousJapanese === 'string' && previousJapanese.trim() ? { previousJapanese: previousJapanese.trim() } : {}),
      ...(typeof nextJapanese === 'string' && nextJapanese.trim() ? { nextJapanese: nextJapanese.trim() } : {}),
    };
    const key = provider.name + '\n' + (context.previousJapanese ?? '') + '\n' + japanese + '\n' + (context.nextJapanese ?? '');
    const existing = cache.get(key);
    if (existing) return Response.json({ translation: existing, provider: provider.name }, { headers });
    const translation = await provider.translate(japanese, AbortSignal.any([request.signal, AbortSignal.timeout(12000)]), context);
    if (cache.size >= 300) cache.delete(cache.keys().next().value!);
    cache.set(key, translation);
    return Response.json({ translation, provider: provider.name }, { headers });
  } catch {
    return Response.json({ error: 'Translation is unavailable right now. Please try again; you can keep shadowing.' }, { status: 503, headers });
  }
}
