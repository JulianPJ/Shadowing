import { BodyLimitError, readBoundedBytes } from './http-body';
import { readBoundedJson } from './http-json';
import type { ShadowingAlignmentOperation } from './shadowing-score';
import type { ShadowingSummarySignals } from './shadowing-session';
import {
  ShadowingProviderError,
  type ShadowingFeedbackInput,
  type ShadowingFeedbackProvider,
} from './providers/shadowing';

export const SHADOWING_AUDIO_LIMIT = 8 * 1024 * 1024;
export const SHADOWING_RECORDING_MAX_MS = 61_000;
export const SHADOWING_RECORDING_MIN_MS = 350;

const headers = { 'Cache-Control': 'no-store' };

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers });
}

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function finite(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function shortString(value: unknown, max = 5000) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid text');
  return value;
}

function boundedStrings(value: unknown, maxItems = 50, maxLength = 80) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error('Invalid list');
  return value.map((item) => {
    if (typeof item !== 'string' || item.length > maxLength) throw new Error('Invalid item');
    return item;
  });
}

function validateAlignment(value: unknown): ShadowingAlignmentOperation[] {
  if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid alignment');
  return value.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid alignment item');
    const raw = item as Record<string, unknown>;
    if (!['match', 'substitution', 'deletion', 'insertion'].includes(raw.type as string))
      throw new Error('Invalid alignment type');
    if (raw.expected !== undefined && (typeof raw.expected !== 'string' || raw.expected.length > 8))
      throw new Error('Invalid expected unit');
    if (raw.heard !== undefined && (typeof raw.heard !== 'string' || raw.heard.length > 8))
      throw new Error('Invalid heard unit');
    return {
      type: raw.type as ShadowingAlignmentOperation['type'],
      ...(typeof raw.expected === 'string' ? { expected: raw.expected } : {}),
      ...(typeof raw.heard === 'string' ? { heard: raw.heard } : {}),
    };
  });
}

function validateFeedbackInput(value: unknown): ShadowingFeedbackInput {
  if (!value || typeof value !== 'object') throw new Error('Invalid feedback');
  const raw = value as Record<string, unknown>;
  const substitutions = Array.isArray(raw.substitutions)
    ? raw.substitutions.map((value) => {
        if (!value || typeof value !== 'object') throw new Error('Invalid substitution');
        const item = value as Record<string, unknown>;
        return {
          expected: shortString(item.expected, 20),
          heard: shortString(item.heard, 20),
        };
      })
    : [];
  if (substitutions.length > 50) throw new Error('Too many substitutions');
  for (const field of ['contentScore', 'timingScore', 'score'] as const)
    if (!finite(raw[field], 0, 100)) throw new Error('Invalid score');
  if (!finite(raw.relativeSpeakingSpeed, 0.05, 20)) throw new Error('Invalid speed');
  return {
    targetText: shortString(raw.targetText),
    recognizedText: shortString(raw.recognizedText),
    alignment: validateAlignment(raw.alignment),
    missing: boundedStrings(raw.missing),
    substitutions,
    additions: boundedStrings(raw.additions),
    contentScore: Math.round(raw.contentScore as number),
    timingScore: Math.round(raw.timingScore as number),
    score: Math.round(raw.score as number),
    relativeSpeakingSpeed: raw.relativeSpeakingSpeed as number,
  };
}

function validateSummarySignals(value: unknown): ShadowingSummarySignals {
  if (!value || typeof value !== 'object') throw new Error('Invalid summary');
  const raw = value as Record<string, unknown>;
  for (const field of ['score', 'averageContentScore', 'averageTimingScore'] as const)
    if (!finite(raw[field], 0, 100)) throw new Error('Invalid aggregate score');
  if (
    !finite(raw.scoredSections, 1, 10_000) ||
    !finite(raw.totalSections, raw.scoredSections as number, 10_000) ||
    typeof raw.fingerprint !== 'string' ||
    !raw.fingerprint ||
    raw.fingerprint.length > 100_000
  )
    throw new Error('Invalid aggregate coverage');
  const pace = raw.pace as Record<string, unknown>;
  if (
    !pace ||
    !finite(pace.faster, 0, 10_000) ||
    !finite(pace.slower, 0, 10_000) ||
    !finite(pace.close, 0, 10_000)
  )
    throw new Error('Invalid pace summary');
  const countList = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid aggregate list');
    return value.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid aggregate item');
      const rawItem = item as Record<string, unknown>;
      if (
        typeof rawItem.value !== 'string' ||
        !rawItem.value ||
        rawItem.value.length > 80 ||
        !finite(rawItem.count, 1, 10_000)
      )
        throw new Error('Invalid aggregate count');
      return { value: rawItem.value, count: Math.round(rawItem.count as number) };
    });
  };
  const substitutionList = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid substitution list');
    return value.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid substitution item');
      const rawItem = item as Record<string, unknown>;
      if (
        typeof rawItem.expected !== 'string' ||
        !rawItem.expected ||
        rawItem.expected.length > 20 ||
        typeof rawItem.heard !== 'string' ||
        !rawItem.heard ||
        rawItem.heard.length > 20 ||
        !finite(rawItem.count, 1, 10_000)
      )
        throw new Error('Invalid substitution count');
      return {
        expected: rawItem.expected,
        heard: rawItem.heard,
        count: Math.round(rawItem.count as number),
      };
    });
  };
  const rankedList = (value: unknown) => {
    if (!Array.isArray(value) || value.length > 3) throw new Error('Invalid ranked list');
    return value.map((item) => {
      if (!item || typeof item !== 'object') throw new Error('Invalid ranked item');
      const rawItem = item as Record<string, unknown>;
      if (
        typeof rawItem.sectionId !== 'string' ||
        !rawItem.sectionId ||
        rawItem.sectionId.length > 200 ||
        !finite(rawItem.score, 0, 100)
      )
        throw new Error('Invalid ranked score');
      return { sectionId: rawItem.sectionId, score: Math.round(rawItem.score as number) };
    });
  };
  return {
    score: Math.round(raw.score as number),
    scoredSections: Math.round(raw.scoredSections as number),
    totalSections: Math.round(raw.totalSections as number),
    averageContentScore: Math.round(raw.averageContentScore as number),
    averageTimingScore: Math.round(raw.averageTimingScore as number),
    fingerprint: raw.fingerprint,
    pace: {
      faster: Math.round(pace.faster as number),
      slower: Math.round(pace.slower as number),
      close: Math.round(pace.close as number),
    },
    commonDeletions: countList(raw.commonDeletions),
    commonAdditions: countList(raw.commonAdditions),
    commonSubstitutions: substitutionList(raw.commonSubstitutions),
    highest: rankedList(raw.highest),
    lowest: rankedList(raw.lowest),
  };
}

export async function handleShadowingTranscriptionRequest(
  request: Request,
  provider: ShadowingFeedbackProvider,
) {
  if (!sameOrigin(request)) return json({ error: 'Open shadowing analysis from your lesson.' }, 403);
  const type = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() || '';
  if (!['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/wav'].includes(type))
    return json({ code: 'unsupported-audio', error: 'This recording format cannot be analysed.' }, 415);
  const durationMs = Number(request.headers.get('x-hibiki-recording-duration-ms'));
  if (!Number.isFinite(durationMs) || durationMs < SHADOWING_RECORDING_MIN_MS)
    return json(
      { code: 'recording-too-short', error: 'That recording is too short to analyse reliably.' },
      422,
    );
  if (durationMs > SHADOWING_RECORDING_MAX_MS)
    return json({ code: 'recording-too-long', error: 'Record one section at a time.' }, 413);
  const length = Number(request.headers.get('content-length'));
  if (Number.isFinite(length) && length > SHADOWING_AUDIO_LIMIT)
    return json({ code: 'audio-too-large', error: 'That recording is too large to analyse.' }, 413);

  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await readBoundedBytes(request, SHADOWING_AUDIO_LIMIT);
  } catch (error) {
    if (error instanceof BodyLimitError)
      return json({ code: 'audio-too-large', error: 'That recording is too large to analyse.' }, 413);
    throw error;
  }
  if (!bytes.byteLength) return json({ code: 'empty-audio', error: 'Record the section first.' }, 400);

  const started = Date.now();
  try {
    const result = await provider.transcribe(
      bytes,
      AbortSignal.any([request.signal, AbortSignal.timeout(45_000)]),
    );
    return json(result);
  } catch (error) {
    const code = error instanceof ShadowingProviderError ? error.code : 'unavailable';
    console.warn(
      JSON.stringify({
        event: 'shadowing-transcription-failed',
        code,
        bytes: bytes.byteLength,
        elapsedMs: Date.now() - started,
      }),
    );
    return json(
      {
        code,
        error:
          error instanceof ShadowingProviderError
            ? error.message
            : 'Shadowing analysis is unavailable right now. Your recording was not saved.',
      },
      code === 'no-speech' ? 422 : code === 'malformed' ? 502 : 503,
    );
  }
}

export async function handleShadowingFeedbackRequest(
  request: Request,
  provider: ShadowingFeedbackProvider,
) {
  if (!sameOrigin(request)) return json({ error: 'Open shadowing feedback from your lesson.' }, 403);
  let input: ShadowingFeedbackInput;
  try {
    input = validateFeedbackInput(await readBoundedJson(request, 50_000));
  } catch {
    return json({ code: 'invalid-analysis', error: 'The scoring result could not be validated.' }, 400);
  }
  try {
    const suggestions = await provider.feedback(
      input,
      AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
    );
    return json({ suggestions, provider: 'Qwen' });
  } catch {
    return json({ code: 'feedback-unavailable', error: 'Feedback is unavailable right now.' }, 503);
  }
}

export async function handleShadowingSummaryRequest(
  request: Request,
  provider: ShadowingFeedbackProvider,
) {
  if (!sameOrigin(request)) return json({ error: 'Open shadowing feedback from your lesson.' }, 403);
  let input: ShadowingSummarySignals;
  try {
    input = validateSummarySignals(await readBoundedJson(request, 40_000));
  } catch {
    return json({ code: 'invalid-summary', error: 'The session summary could not be validated.' }, 400);
  }
  try {
    return json({
      ...(await provider.summary(
        input,
        AbortSignal.any([request.signal, AbortSignal.timeout(25_000)]),
      )),
      provider: 'Qwen',
    });
  } catch {
    return json({ code: 'summary-unavailable', error: 'Summary feedback is unavailable.' }, 503);
  }
}
