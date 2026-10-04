'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Lesson } from '@/lib/types';
import {
  readStorage,
  writeStorage,
  loadTranslationCache,
  translationCacheKey,
} from '@/lib/storage';
import type { Segment } from '@/lib/types';
import type { PracticeSignal } from '@/lib/learner-progress';
export function useSectionTranslation(
  lesson: Lesson,
  index: number,
  initialIndex: number,
  recordSignal: (segment: Segment, signal: PracticeSignal) => void,
) {
  const segment = lesson.segments[index];
  const [revealed, setRevealed] = useState(
    () =>
      readStorage<unknown>(`reveal:${lesson.id}:${lesson.segments[initialIndex].id}`, false) ===
      true,
  );
  const [translations, setTranslations] = useState<Record<string, string>>(() =>
    loadTranslationCache(lesson.id),
  );
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [translationProvider, setTranslationProvider] = useState('');
  const translationAbort = useRef<AbortController | null>(null);
  const translation = segment.translation || translations[segment.id];
  const resetTranslation = useCallback(() => {
    translationAbort.current?.abort();
    setTranslating(false);
    setTranslationError('');
    setTranslationProvider('');
    setRevealed(false);
  }, []);
  const revealTranslation = useCallback(async () => {
    if (revealed) {
      setRevealed(false);
      setTranslationError('');
      return;
    }
    recordSignal(segment, 'translation-reveal');
    setTranslationError('');
    if (translation) {
      setRevealed(true);
      return;
    }
    const controller = new AbortController();
    translationAbort.current?.abort();
    translationAbort.current = controller;
    setTranslating(true);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          japanese: segment.japanese,
          previousJapanese: lesson.segments[index - 1]?.japanese,
          nextJapanese: lesson.segments[index + 1]?.japanese,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const data = await response.json();
      if (!response.ok || typeof data.translation !== 'string' || !data.translation.trim())
        throw new Error(data.error || 'Translation is unavailable right now. Try again later.');
      if (!controller.signal.aborted) {
        setTranslations((current) => ({ ...current, [segment.id]: data.translation }));
        setTranslationProvider(typeof data.provider === 'string' ? data.provider : '');
        setRevealed(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setRevealed(false);
        setTranslationError(
          error instanceof Error && error.name !== 'TimeoutError'
            ? error.message
            : 'Translation took too long. Please try again.',
        );
      }
    } finally {
      if (!controller.signal.aborted) setTranslating(false);
    }
  }, [revealed, translation, segment, recordSignal, lesson.segments, index]);
  useEffect(() => {
    writeStorage(`reveal:${lesson.id}:${segment.id}`, revealed);
  }, [lesson.id, segment.id, revealed]);
  useEffect(() => {
    writeStorage(translationCacheKey(lesson.id), translations);
  }, [lesson.id, translations]);
  useEffect(
    () => () => {
      translationAbort.current?.abort();
    },
    [],
  );
  return {
    revealed,
    translation,
    translations,
    translating,
    translationError,
    translationProvider,
    resetTranslation,
    revealTranslation,
    setTranslationError,
  };
}
