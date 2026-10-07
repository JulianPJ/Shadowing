'use client';
import type { Lesson } from '../types';
import type { MorphologicalToken } from '../japanese-readings';
import { analyzeJapaneseBatch } from '../japanese-analysis';
import { loadKnowledge } from './client';
import { analyzeVocabulary } from './analysis';
const cache = new Map<string, Promise<Record<string, readonly MorphologicalToken[]>>>();
async function analyzeLesson(lesson: Lesson, signal?: AbortSignal) {
  const tokens: Record<string, readonly MorphologicalToken[]> = {};
  const analyzed = await analyzeJapaneseBatch(
    lesson.segments.map((segment) => ({ id: segment.id, text: segment.japanese })),
    { signal, priority: 'background' },
  );
  for (const analysis of analyzed) tokens[analysis.id] = analysis.tokens;
  return tokens;
}
export function lessonTokens(lesson: Lesson, signal?: AbortSignal) {
  // Cancellable callers own their window scheduling, while individual canonical requests
  // still share the analysis cache. Never put a consumer's aborted promise in the lesson cache.
  if (signal) return analyzeLesson(lesson, signal);
  const key = JSON.stringify(lesson.segments.map((segment) => [segment.id, segment.japanese]));
  const existing = cache.get(key);
  if (existing) return existing;
  const request = analyzeLesson(lesson);
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
