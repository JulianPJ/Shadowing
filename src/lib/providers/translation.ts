import type { TranslationContext, TranslationProvider } from '../types';
import { cleanText } from '../segmentation';
import { object } from '../quiz';
import { runWorkersAi, WORKERS_AI_TRANSLATION_MODEL, type WorkersAiBindingLike } from './workers-ai';

const QWEN_TRANSLATION_SYSTEM_PROMPT = 'You are a Japanese-to-English translation engine. Translate ONLY the text inside <current>. Text inside <previous> and <next> is context only: use it to resolve meaning, but NEVER translate, quote, paraphrase, or include it in the answer. Preserve names and titles. Output only the natural English translation of <current>, with no label, quotes, explanation, or extra text.';

function chunks(text: string): string[] {
  const parts: string[] = []; let part = '';
  for (const char of text) {
    if (new TextEncoder().encode(part + char).length > 450) { parts.push(part); part = ''; }
    part += char;
  }
  if (part) parts.push(part);
  return parts;
}

function qwenTranslationMessages(japanese: string, context?: TranslationContext) {
  const parts = [
    context?.previousJapanese ? `<previous>${context.previousJapanese}</previous>` : '',
    `<current>${japanese}</current>`,
    context?.nextJapanese ? `<next>${context.nextJapanese}</next>` : '',
    '/no_think',
  ].filter(Boolean);
  return [
    { role: 'system', content: QWEN_TRANSLATION_SYSTEM_PROMPT },
    { role: 'user', content: parts.join('\n') },
  ];
}

function parseQwenTranslation(response: unknown): string {
  const raw = object(response);
  let translated: unknown = raw.response;
  if (typeof translated !== 'string') {
    if (!Array.isArray(raw.choices) || !raw.choices.length) throw new Error('Invalid translation response.');
    const choice = object(raw.choices[0]);
    if (choice.finish_reason !== undefined && choice.finish_reason !== 'stop') throw new Error('Incomplete translation response.');
    translated = object(choice.message).content;
  }
  if (typeof translated !== 'string' || !translated.trim() || translated.length > 10000) throw new Error('Invalid translation response.');
  return cleanText(translated);
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
    name: 'Workers AI · Qwen3',
    async translate(japanese, signal, context) {
      const activeSignal = signal ?? new AbortController().signal;
      const response = await runWorkersAi<unknown>(ai, WORKERS_AI_TRANSLATION_MODEL, {
        messages: qwenTranslationMessages(japanese, context),
        max_tokens: 800,
        temperature: 0,
      }, activeSignal);
      return parseQwenTranslation(response);
    },
  };
}
