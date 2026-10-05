import { japaneseReadings } from './furigana-client';
import {
  fallbackShadowingSuggestions,
  scoreShadowingAttempt,
  SHADOWING_SCORE_CONSTANTS,
  type ShadowingAttemptAnalysis,
} from './shadowing-score';
import {
  fallbackShadowingSummary,
  type ShadowingSummarySignals,
} from './shadowing-session';

export type ShadowingTranscriptionResponse = {
  recognizedText: string;
  speechStart: number;
  speechEnd: number;
  provider: string;
};

async function jsonResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(
      typeof data.error === 'string' && data.error
        ? data.error
        : 'Shadowing analysis is unavailable right now.',
    );
  return data;
}

export function validateShadowingRecordingBeforeUpload(
  recordingDurationSeconds: number,
  referenceDurationSeconds: number,
) {
  if (
    recordingDurationSeconds < SHADOWING_SCORE_CONSTANTS.minimumRecordingSeconds ||
    recordingDurationSeconds / referenceDurationSeconds <
      SHADOWING_SCORE_CONSTANTS.minimumDurationRatio
  )
    throw new Error('That recording is too short for a reliable match. Try the full section again.');
}

export async function transcribeShadowingRecording(
  recording: Blob,
  recordingDurationSeconds: number,
  signal: AbortSignal,
) {
  if (recording.size > 8 * 1024 * 1024)
    throw new Error('That recording is too large to analyse. Record one section at a time.');
  const response = await fetch('/api/shadowing/transcribe', {
    method: 'POST',
    headers: {
      'Content-Type': recording.type || 'audio/webm',
      'X-Hibiki-Recording-Duration-Ms': String(Math.round(recordingDurationSeconds * 1000)),
    },
    body: recording,
    signal: AbortSignal.any([signal, AbortSignal.timeout(50_000)]),
  });
  return jsonResponse<ShadowingTranscriptionResponse>(response);
}

async function localReading(text: string) {
  const tokens = await japaneseReadings(text);
  return tokens.map((token) => token.reading ?? token.text).join('');
}

export async function deterministicShadowingAnalysis(input: {
  targetText: string;
  recognizedText: string;
  referenceDurationSeconds: number;
  recordingDurationSeconds: number;
}): Promise<ShadowingAttemptAnalysis> {
  let targetReading: string | undefined;
  let recognizedReading: string | undefined;
  try {
    [targetReading, recognizedReading] = await Promise.all([
      localReading(input.targetText),
      localReading(input.recognizedText),
    ]);
  } catch {
    // Scoring remains deterministic using orthographic normalization if local readings are unavailable.
  }
  return scoreShadowingAttempt({ ...input, targetReading, recognizedReading });
}

export async function shadowingAttemptFeedback(
  analysis: ShadowingAttemptAnalysis,
  signal: AbortSignal,
) {
  try {
    const response = await fetch('/api/shadowing/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        targetText: analysis.targetText,
        recognizedText: analysis.recognizedText,
        alignment: analysis.alignment,
        missing: analysis.missing,
        substitutions: analysis.substitutions,
        additions: analysis.additions,
        contentScore: analysis.contentScore,
        timingScore: analysis.timingScore,
        score: analysis.score,
        relativeSpeakingSpeed: analysis.relativeSpeakingSpeed,
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    const result = await jsonResponse<{ suggestions: string[] }>(response);
    if (!Array.isArray(result.suggestions) || !result.suggestions.length) throw new Error('No feedback');
    return result.suggestions.slice(0, 3);
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return fallbackShadowingSuggestions(analysis);
  }
}

export async function shadowingSessionSummary(signals: ShadowingSummarySignals, signal: AbortSignal) {
  try {
    const response = await fetch('/api/shadowing/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(signals),
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    const result = await jsonResponse<{ wentWell: string; keepWorking: string }>(response);
    if (!result.wentWell?.trim() || !result.keepWorking?.trim()) throw new Error('No summary');
    return {
      provider: 'qwen' as const,
      wentWell: result.wentWell.trim(),
      keepWorking: result.keepWorking.trim(),
    };
  } catch {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    return fallbackShadowingSummary(signals);
  }
}
