'use client';

import type { Lesson, Segment } from './types';
import {
  aggregateShadowingScores,
  readingText,
  scoreShadowingAttempt,
  withShadowingSuggestions,
  type ScoredShadowingSection,
  type ShadowingAggregate,
  type ShadowingScoreAnalysis,
  type ShadowingScoreResult,
} from './shadowing-score';
import { japaneseReadings } from './furigana-client';

export const SHADOWING_RECORDING_LIMIT = 8 * 1024 * 1024;

type TranscriptionResponse = {
  recognizedText?: string;
  speechDuration?: number;
  provider?: string;
  code?: string;
  error?: string;
};

async function responseJson<T>(response: Response): Promise<T & { error?: string; code?: string }> {
  try {
    return (await response.json()) as T & { error?: string; code?: string };
  } catch {
    return { error: 'The analysis service returned an unreadable response.' } as T & {
      error?: string;
      code?: string;
    };
  }
}

export async function transcribeShadowingRecording(blob: Blob, signal: AbortSignal) {
  if (!blob.size) throw new Error('Record the section before analysing it.');
  if (blob.size > SHADOWING_RECORDING_LIMIT)
    throw new Error('That recording is too large to analyse. Record the section again.');
  if (blob.type && !blob.type.startsWith('audio/'))
    throw new Error('This recording format is not supported for analysis.');
  const response = await fetch('/api/shadowing/transcribe', {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': blob.type || 'audio/webm',
      'X-Hibiki-Shadowing': 'attempt',
    },
    body: blob,
  });
  const result = await responseJson<TranscriptionResponse>(response);
  if (!response.ok)
    throw new Error(result.error || 'Shadowing transcription is unavailable right now.');
  if (
    typeof result.recognizedText !== 'string' ||
    !result.recognizedText.trim() ||
    typeof result.speechDuration !== 'number' ||
    !Number.isFinite(result.speechDuration)
  )
    throw new Error('No meaningful Japanese speech was recognised. Please record the section again.');
  return {
    recognizedText: result.recognizedText.trim(),
    speechDuration: result.speechDuration,
    provider: result.provider || 'Cloudflare Whisper large-v3-turbo',
  };
}

async function bestReading(text: string) {
  try {
    return readingText(text, await japaneseReadings(text));
  } catch {
    return text;
  }
}

export async function scoreRecognizedShadowing(
  segment: Pick<Segment, 'japanese' | 'start' | 'end'>,
  recognizedText: string,
  speechDuration: number,
): Promise<ShadowingScoreResult> {
  const [targetReading, recognizedReading] = await Promise.all([
    bestReading(segment.japanese),
    bestReading(recognizedText),
  ]);
  return scoreShadowingAttempt({
    targetText: segment.japanese,
    recognizedText,
    targetReading,
    recognizedReading,
    targetDuration: segment.end - segment.start,
    speechDuration,
  });
}

export async function requestShadowingFeedback(
  analysis: ShadowingScoreAnalysis,
  signal: AbortSignal,
): Promise<ShadowingScoreAnalysis> {
  const response = await fetch('/api/shadowing/feedback', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Hibiki-Shadowing': 'feedback' },
    body: JSON.stringify({ analysis }),
  });
  const result = await responseJson<{ suggestions?: string[] }>(response);
  if (!response.ok || !Array.isArray(result.suggestions)) return analysis;
  return withShadowingSuggestions(analysis, result.suggestions);
}

export async function requestShadowingSummary(
  aggregate: ShadowingAggregate,
  sections: readonly ScoredShadowingSection[],
  signal: AbortSignal,
) {
  const response = await fetch('/api/shadowing/summary', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Hibiki-Shadowing': 'summary' },
    body: JSON.stringify({ aggregate, sections }),
  });
  const result = await responseJson<{
    summary?: { whatWentWell?: string; keepWorkingOn?: string };
  }>(response);
  const summary = result.summary;
  if (
    response.ok &&
    summary &&
    typeof summary.whatWentWell === 'string' &&
    typeof summary.keepWorkingOn === 'string' &&
    summary.whatWentWell.trim() &&
    summary.keepWorkingOn.trim()
  )
    return {
      whatWentWell: summary.whatWentWell.trim(),
      keepWorkingOn: summary.keepWorkingOn.trim(),
    };
  throw new Error(result.error || 'Session feedback is unavailable.');
}

function fnv1a(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function shadowingSessionKey(lesson: Pick<Lesson, 'id' | 'segments'>) {
  const identity = lesson.segments.map((segment) => `${segment.id}\u0000${segment.japanese}`).join('\u0001');
  return `hibiki:v1:shadowing-session:${encodeURIComponent(lesson.id)}:${fnv1a(identity)}`;
}

export function loadShadowingSession(lesson: Pick<Lesson, 'id' | 'segments'>): ScoredShadowingSection[] {
  if (typeof window === 'undefined') return [];
  try {
    const value = JSON.parse(sessionStorage.getItem(shadowingSessionKey(lesson)) || '[]');
    if (!Array.isArray(value)) return [];
    const ids = new Set(lesson.segments.map((segment) => segment.id));
    return value.filter((item): item is ScoredShadowingSection => {
      if (!item || typeof item !== 'object') return false;
      const section = item as Partial<ScoredShadowingSection>;
      return (
        typeof section.sectionId === 'string' &&
        ids.has(section.sectionId) &&
        typeof section.attemptId === 'string' &&
        typeof section.scoredAt === 'string' &&
        !!section.analysis &&
        Number.isInteger(section.analysis.score) &&
        section.analysis.score >= 0 &&
        section.analysis.score <= 100
      );
    });
  } catch {
    return [];
  }
}

export function saveShadowingSession(
  lesson: Pick<Lesson, 'id' | 'segments'>,
  sections: readonly ScoredShadowingSection[],
) {
  try {
    sessionStorage.setItem(shadowingSessionKey(lesson), JSON.stringify(sections));
    return true;
  } catch {
    return false;
  }
}

export function clearShadowingSession(lesson: Pick<Lesson, 'id' | 'segments'>) {
  try {
    sessionStorage.removeItem(shadowingSessionKey(lesson));
  } catch {
    /* Session scoring is optional; playback must remain usable. */
  }
}

export function shadowingAggregate(
  lesson: Pick<Lesson, 'segments'>,
  sections: readonly ScoredShadowingSection[],
) {
  return aggregateShadowingScores(sections, lesson.segments.length);
}
