'use client';
import type { Lesson } from '../types';
import type { MorphologicalToken } from '../japanese-readings';
import { japaneseMorphology } from '../furigana-client';
import { loadKnowledge } from './client';
import { analyzeVocabulary } from './analysis';
const cache = new Map<string, Promise<Record<string, readonly MorphologicalToken[]>>>();
export function lessonTokens(lesson: Lesson) {
  const key = JSON.stringify(lesson.segments.map((segment) => [segment.id, segment.japanese]));
  const existing = cache.get(key);
  if (existing) return existing;
  const request = (async () => {
    const tokens: Record<string, readonly MorphologicalToken[]> = {};
    // Bounded worker requests allow long transcripts without blocking the browser main thread.
    for (let start = 0; start < lesson.segments.length; start += 8) {
      const sections = lesson.segments.slice(start, start + 8);
      const values = await Promise.all(
        sections.map((segment) => japaneseMorphology(segment.japanese)),
      );
      sections.forEach((segment, index) => {
        tokens[segment.id] = values[index];
      });
    }
    return tokens;
  })();
  cache.set(key, request);
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  void request.catch(() => {
    if (cache.get(key) === request) cache.delete(key);
  });
  return request;
}
export async function lessonVocabulary(lesson: Lesson) {
  return analyzeVocabulary(lesson.segments, await lessonTokens(lesson), loadKnowledge());
}
