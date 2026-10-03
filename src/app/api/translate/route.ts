import { myMemoryTranslation } from '@/lib/providers/translation';
export const maxDuration = 20;
const cache = new Map<string, string>();
export async function POST(request: Request) {
  try {
    const raw = await request.text();
    if (raw.length > 5000) return Response.json({ error: 'This section is too long to translate.' }, { status: 400 });
    const { japanese } = JSON.parse(raw);
    if (typeof japanese !== 'string' || !japanese.trim() || japanese.length > 1200) return Response.json({ error: 'A Japanese sentence is required (up to 1,200 characters).' }, { status: 400 });
    const existing = cache.get(japanese);
    if (existing) return Response.json({ translation: existing, provider: myMemoryTranslation.name });
    const translation = await myMemoryTranslation.translate(japanese, AbortSignal.any([request.signal, AbortSignal.timeout(12000)]));
    if (cache.size >= 200) cache.delete(cache.keys().next().value!);
    cache.set(japanese, translation);
    return Response.json({ translation, provider: myMemoryTranslation.name });
  } catch {
    return Response.json({ error: 'Translation is unavailable right now. The free service may be busy or at its daily limit. Try again later; you can keep shadowing.' }, { status: 503 });
  }
}
