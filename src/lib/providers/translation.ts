import type { TranslationProvider } from '../types';
import { cleanText } from '../segmentation';
import { object } from '../quiz';
import { runWorkersAi, WORKERS_AI_TRANSLATION_MODEL, type WorkersAiBindingLike } from './workers-ai';

function chunks(text: string): string[] {
  const parts: string[] = []; let part = '';
  for (const char of text) {
    if (new TextEncoder().encode(part + char).length > 450) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

// Keyless fallback for local/non-Cloudflare development only.
export const myMemoryTranslation: TranslationProvider = {
  name: 'MyMemory',
  async translate(japanese, signal) {
    const translated: string[] = [];
    for (const part of chunks(japanese)) {
      const url = new URL('https://api.mymemory.translated.net/get');
      url.searchParams.set('q', part); url.searchParams.set('langpair', 'ja|en');
      const response = await fetch(url, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error('Translation service is unavailable.');
      const data = await response.json();
      const result = data.responseData?.translatedText;
      if (Number(data.responseStatus) !== 200 || data.quotaFinished || typeof result !== 'string' || !result.trim() || /MYMEMORY WARNING|QUERY LENGTH LIMIT|INVALID LANGUAGE PAIR/i.test(result)) throw new Error('Translation is unavailable or the free daily limit has been reached.');
      translated.push(cleanText(result));
    }
    return translated.join(' ');
  },
};

export function createWorkersAiTranslationProvider(ai: WorkersAiBindingLike): TranslationProvider {
  return {
    name: 'Workers AI',
    async translate(japanese, signal) {
      const activeSignal = signal ?? new AbortController().signal;
      const response = await runWorkersAi<unknown>(ai, WORKERS_AI_TRANSLATION_MODEL, {
        text: japanese,
        source_lang: 'japanese',
        target_lang: 'english',
      }, activeSignal);
      const raw = object(response);
      const translated = raw.translated_text;
      if (typeof translated !== 'string' || !translated.trim() || translated.length > 10000) throw new Error('Invalid translation response.');
      return cleanText(translated);
    },
  };
}
