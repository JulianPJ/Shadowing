import type { TranslationContext, TranslationProvider } from '../types';
import { cleanText } from '../segmentation';

const DEEPL_FREE_API = 'https://api-free.deepl.com';
const DEEPL_PRO_API = 'https://api.deepl.com';

function chunks(text: string): string[] {
  const parts: string[] = [];
  let part = '';
  for (const char of text) {
    if (new TextEncoder().encode(part + char).length > 450) {
      parts.push(part);
      part = '';
    }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

function deepLContext(context?: TranslationContext) {
  return [context?.previousJapanese, context?.nextJapanese]
    .filter((value): value is string => Boolean(value?.trim()))
    .join('\n');
}

function deepLEndpoint(authKey: string) {
  return `${authKey.trim().endsWith(':fx') ? DEEPL_FREE_API : DEEPL_PRO_API}/v2/translate`;
}

// Keyless fallback for local/non-Cloudflare development only.
export const myMemoryTranslation: TranslationProvider = {
  name: 'MyMemory',
  async translate(japanese, signal) {
    const translated: string[] = [];
    for (const part of chunks(japanese)) {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', part);
      url.searchParams.set('langpair', 'ja|en');
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Translation service is unavailable.');
      const data = await response.json();
      const result = data.responseData?.translatedText;
      if (
        Number(data.responseStatus) !== 200 ||
        data.quotaFinished ||
        typeof result !== 'string' ||
        !result.trim() ||
        /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(result)
      )
        throw new Error('Translation is unavailable or the free daily limit has been reached.');
      translated.push(cleanText(result));
    }
    return translated.join(' ');
  },
};

export function createDeepLTranslationProvider(
  authKey: string,
  fetcher: typeof fetch = fetch,
): TranslationProvider {
  const key = authKey.trim();
  if (!key) throw new Error('DeepL is not configured.');
  return {
    name: 'DeepL',
    async translate(japanese, signal, context) {
      const contextualJapanese = deepLContext(context);
      const response = await fetcher(deepLEndpoint(key), {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [japanese],
          source_lang: 'JA',
          target_lang: 'EN-US',
          ...(contextualJapanese ? { context: contextualJapanese } : {}),
        }),
        signal,
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('DeepL translation is unavailable.');
      const data = (await response.json()) as { translations?: Array<{ text?: unknown }> };
      const translated = data.translations?.[0]?.text;
      if (typeof translated !== 'string' || !translated.trim() || translated.length > 10000)
        throw new Error('Invalid DeepL translation response.');
      return cleanText(translated);
    },
  };
}
