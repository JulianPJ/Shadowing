import type { TranslationProvider } from '../types';
import { cleanText } from '../segmentation';
function chunks(text: string): string[] {
  const parts: string[] = []; let part = '';
  for (const char of text) {
    if (new TextEncoder().encode(part + char).length > 450) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}
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
