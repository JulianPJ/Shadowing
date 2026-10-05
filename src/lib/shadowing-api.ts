import { BodyLimitError, readBoundedBytes } from './http-body';
import { readBoundedJson } from './http-json';
import type {
  ShadowingFeedbackProvider,
  ShadowingTranscriptionProvider,
} from './providers/shadowing';
import type {
  ScoredShadowingSection,
  ShadowingAggregate,
  ShadowingAlignmentOperation,
  ShadowingScoreAnalysis,
} from './shadowing-score';

export const SHADOWING_AUDIO_LIMIT = 8 * 1024 * 1024;
export const SHADOWING_FEEDBACK_LIMIT = 32000;
export const SHADOWING_SUMMARY_LIMIT = 96000;

type RateLimitBinding = {
  limit(options: { key: string }): Promise<{ success: boolean }>;
};

function noStore(body: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', ...extraHeaders },
  });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

export async function applyShadowingRateLimit(
  request: Request,
  limiter?: RateLimitBinding,
): Promise<Response | null> {
  if (!limiter) return null;
  const key =
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for')?.split(',', 1)[0]?.trim() ||
    'unknown';
  try {
    const result = await limiter.limit({ key });
    return result.success
      ? null
      : noStore(
          { code: 'rate-limited', error: 'Too many analysis requests. Please wait a moment and try again.' },
          429,
          { 'Retry-After': '60' },
        );
  } catch {
    // Do not turn a rate-limiter service issue into a practice outage.
    return null;
  }
}

export async function handleShadowingTranscriptionRequest(
  request: Request,
  provider: ShadowingTranscriptionProvider,
) {
  if (!sameOrigin(request))
    return noStore({ code: 'origin', error: 'Open shadowing analysis from your Hibiki lesson.' }, 403);
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (!type.startsWith('audio/'))
    return noStore({ code: 'audio-type', error: 'Record an audio attempt before analysing.' }, 415);
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > SHADOWING_AUDIO_LIMIT)
    return noStore({ code: 'audio-too-large', error: 'That recording is too large to analyse. Record the section again.' }, 413);

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBoundedBytes(request, SHADOWING_AUDIO_LIMIT);
  } catch (error) {
    if (error instanceof BodyLimitError)
      return noStore({ code: 'audio-too-large', error: 'That recording is too large to analyse. Record the section again.' }, 413);
    throw error;
  }
  if (bytes.byteLength < 256)
    return noStore({ code: 'audio-empty', error: 'That recording did not contain enough audio to analyse.' }, 422);

  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(45000)]);
  const started = Date.now();
  try {
    const result = await provider.transcribe(bytes, signal);
    if (!result.recognizedText || result.speechDuration <= 0)
      return noStore(
        {
          code: 'no-speech',
          error: 'No meaningful Japanese speech was recognised. Please record the section again.',
        },
        422,
      );
    if (result.recognizedText.length > 4000)
      return noStore(
        { code: 'unreliable-transcript', error: 'The transcription was not reliable enough to score. Please try again.' },
        422,
      );
    return noStore({
      recognizedText: result.recognizedText,
      speechDuration: result.speechDuration,
      provider: result.provider,
    });
  } catch {
    console.warn(
      JSON.stringify({
        event: 'shadowing-transcription-failed',
        provider: provider.name,
        bytes: bytes.byteLength,
        elapsedMs: Date.now() - started,
        aborted: signal.aborted,
      }),
    );
    return noStore(
      {
        code: 'transcription-unavailable',
        error: 'Shadowing analysis is unavailable right now. Your recording is still on this device; try again when ready.',
      },
      503,
    );
  } finally {
    controller.abort();
  }
}

function finiteScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
}

function validAlignment(value: unknown): value is ShadowingAlignmentOperation[] {
  return (
    Array.isArray(value) &&
    value.length <= 240 &&
    value.every((operation) => {
      if (!operation || typeof operation !== 'object') return false;
      const item = operation as Record<string, unknown>;
      return (
        ['match', 'substitution', 'deletion', 'insertion'].includes(String(item.type)) &&
        (item.target === undefined || (typeof item.target === 'string' && item.target.length <= 8)) &&
        (item.heard === undefined || (typeof item.heard === 'string' && item.heard.length <= 8))
      );
    })
  );
}

export function validateShadowingAnalysis(value: unknown): ShadowingScoreAnalysis {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid analysis');
  const item = value as Record<string, unknown>;
  if (
    item.schemaVersion !== 1 ||
    typeof item.targetText !== 'string' ||
    typeof item.recognizedText !== 'string' ||
    item.targetText.length > 1500 ||
    item.recognizedText.length > 4000 ||
    typeof item.targetReading !== 'string' ||
    typeof item.recognizedReading !== 'string' ||
    item.targetReading.length > 3000 ||
    item.recognizedReading.length > 6000 ||
    !finiteScore(item.score) ||
    !finiteScore(item.contentScore) ||
    !finiteScore(item.timingScore) ||
    typeof item.contentSimilarity !== 'number' ||
    typeof item.timingSimilarity !== 'number' ||
    typeof item.targetDuration !== 'number' ||
    typeof item.speechDuration !== 'number' ||
    typeof item.durationRatio !== 'number' ||
    !['faster', 'close', 'slower'].includes(String(item.pace)) ||
    !validAlignment(item.alignment)
  )
    throw new Error('Invalid analysis');
  for (const key of ['matches', 'deletions', 'substitutions', 'insertions', 'targetUnits', 'recognizedUnits']) {
    const value = item[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0)
      throw new Error('Invalid analysis');
  }
  return item as unknown as ShadowingScoreAnalysis;
}

export async function handleShadowingFeedbackRequest(
  request: Request,
  provider: ShadowingFeedbackProvider,
) {
  if (!sameOrigin(request))
    return noStore({ code: 'origin', error: 'Open shadowing feedback from your Hibiki lesson.' }, 403);
  let analysis: ShadowingScoreAnalysis;
  try {
    const body = await readBoundedJson(request, SHADOWING_FEEDBACK_LIMIT);
    const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    analysis = validateShadowingAnalysis(raw.analysis);
  } catch {
    return noStore({ code: 'invalid-analysis', error: 'A valid shadowing analysis is required.' }, 400);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(18000)]);
  try {
    const suggestions = await provider.feedback(analysis, signal);
    return noStore({ suggestions });
  } catch {
    console.warn(
      JSON.stringify({
        event: 'shadowing-feedback-failed',
        score: analysis.score,
        deletions: analysis.deletions,
        substitutions: analysis.substitutions,
        insertions: analysis.insertions,
      }),
    );
    return noStore({ code: 'feedback-unavailable', error: 'Extra feedback is unavailable right now.' }, 503);
  }
}

function validateAggregate(value: unknown): ShadowingAggregate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid aggregate');
  const aggregate = value as Record<string, unknown>;
  if (
    !finiteScore(aggregate.score) ||
    !Number.isInteger(aggregate.scoredSections) ||
    !Number.isInteger(aggregate.totalSections) ||
    Number(aggregate.scoredSections) < 1 ||
    Number(aggregate.totalSections) < Number(aggregate.scoredSections)
  )
    throw new Error('Invalid aggregate');
  return value as ShadowingAggregate;
}

function validateScoredSections(value: unknown): ScoredShadowingSection[] {
  if (!Array.isArray(value) || !value.length || value.length > 500) throw new Error('Invalid sections');
  const unique = new Set<string>();
  return value.map((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid section');
    const item = raw as Record<string, unknown>;
    if (
      typeof item.sectionId !== 'string' ||
      !item.sectionId ||
      item.sectionId.length > 250 ||
      typeof item.attemptId !== 'string' ||
      item.attemptId.length > 250 ||
      typeof item.scoredAt !== 'string'
    )
      throw new Error('Invalid section');
    if (unique.has(item.sectionId)) throw new Error('Duplicate section');
    unique.add(item.sectionId);
    return {
      sectionId: item.sectionId,
      attemptId: item.attemptId,
      scoredAt: item.scoredAt,
      analysis: validateShadowingAnalysis(item.analysis),
    };
  });
}

export async function handleShadowingSummaryRequest(
  request: Request,
  provider: ShadowingFeedbackProvider,
) {
  if (!sameOrigin(request))
    return noStore({ code: 'origin', error: 'Open the session summary from your Hibiki lesson.' }, 403);
  let aggregate: ShadowingAggregate;
  let sections: ScoredShadowingSection[];
  try {
    const body = await readBoundedJson(request, SHADOWING_SUMMARY_LIMIT);
    const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    aggregate = validateAggregate(raw.aggregate);
    sections = validateScoredSections(raw.sections);
    if (sections.length !== aggregate.scoredSections) throw new Error('Coverage mismatch');
  } catch {
    return noStore({ code: 'invalid-summary', error: 'A valid shadowing session summary is required.' }, 400);
  }
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(18000)]);
  try {
    return noStore({ summary: await provider.summary(aggregate, sections, signal) });
  } catch {
    console.warn(
      JSON.stringify({
        event: 'shadowing-summary-failed',
        score: aggregate.score,
        scoredSections: aggregate.scoredSections,
        totalSections: aggregate.totalSections,
      }),
    );
    return noStore({ code: 'summary-unavailable', error: 'Extra session feedback is unavailable right now.' }, 503);
  }
}
