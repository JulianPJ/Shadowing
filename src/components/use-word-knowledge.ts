'use client';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Lesson } from '@/lib/types';
import type { MorphologicalToken } from '@/lib/japanese-readings';
import { loadKnowledge, knowledgePending } from '@/lib/knowledge/client';
import { lessonTokens } from '@/lib/knowledge/lesson';
import { analyzeVocabulary } from '@/lib/knowledge/analysis';
import type { KnowledgeStates } from '@/lib/knowledge/types';

const empty = { states: {} as KnowledgeStates, pending: 0 };
const emptyTokens: Record<string, readonly MorphologicalToken[]> = {};
let snapshot = empty,
  initialized = false,
  fingerprint = '';
const listeners = new Set<() => void>();
function refreshKnowledge() {
  const value = { states: loadKnowledge(), pending: knowledgePending() };
  const next = JSON.stringify(value);
  initialized = true;
  if (next === fingerprint) return;
  fingerprint = next;
  snapshot = value;
  for (const listener of listeners) listener();
}
function subscribeKnowledge(listener: () => void) {
  if (!listeners.size) {
    refreshKnowledge();
    window.addEventListener('hibiki:knowledge-change', refreshKnowledge);
    window.addEventListener('hibiki:account-change', refreshKnowledge);
    window.addEventListener('storage', refreshKnowledge);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      window.removeEventListener('hibiki:knowledge-change', refreshKnowledge);
      window.removeEventListener('hibiki:account-change', refreshKnowledge);
      window.removeEventListener('storage', refreshKnowledge);
      initialized = false;
    }
  };
}
function currentKnowledge() {
  if (!initialized && typeof window !== 'undefined') refreshKnowledge();
  return snapshot;
}
const disabledSubscribe = () => () => {};
export function useWordKnowledge(enabled = true) {
  return useSyncExternalStore(
    enabled ? subscribeKnowledge : disabledSubscribe,
    enabled ? currentKnowledge : () => empty,
    () => empty,
  );
}
export function useLessonVocabulary(lesson: Lesson, enabled = true) {
  const { states, pending } = useWordKnowledge();
  const [result, setResult] = useState<{
    lesson: Lesson;
    tokens: Record<string, readonly MorphologicalToken[]>;
    error: string;
  } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void lessonTokens(lesson)
      .then((tokens) => {
        if (active) setResult({ lesson, tokens, error: '' });
      })
      .catch(() => {
        if (active)
          setResult({
            lesson,
            tokens: {},
            error:
              'Local vocabulary analysis is unavailable. Your word states and playback remain available.',
          });
      });
    return () => {
      active = false;
    };
  }, [lesson, enabled]);
  const tokensBySegment = result?.lesson === lesson ? result.tokens : emptyTokens;
  const analysis = useMemo(
    () => analyzeVocabulary(lesson.segments, tokensBySegment, states),
    [lesson, tokensBySegment, states],
  );
  return {
    analysis,
    tokensBySegment,
    states,
    pending,
    loading: enabled && result?.lesson !== lesson,
    error: result?.lesson === lesson ? result.error : '',
  };
}
