import type { ShadowingSectionResult } from './shadowing-score';

export type ShadowingSessionSummary = {
  fingerprint: string;
  provider: 'qwen' | 'fallback';
  wentWell: string;
  keepWorking: string;
};

export type ShadowingScoreSession = {
  schemaVersion: 1;
  lessonId: string;
  transcriptRevision: string;
  sections: Record<string, ShadowingSectionResult>;
  summary?: ShadowingSessionSummary;
};

export type ShadowingAggregate = {
  score: number;
  scoredSections: number;
  totalSections: number;
  averageContentScore: number;
  averageTimingScore: number;
};

export type ShadowingSummarySignals = ShadowingAggregate & {
  fingerprint: string;
  pace: { faster: number; slower: number; close: number };
  commonDeletions: { value: string; count: number }[];
  commonAdditions: { value: string; count: number }[];
  commonSubstitutions: { expected: string; heard: string; count: number }[];
  highest: { sectionId: string; score: number }[];
  lowest: { sectionId: string; score: number }[];
};

export function createShadowingSession(
  lessonId: string,
  transcriptRevision: string,
): ShadowingScoreSession {
  return { schemaVersion: 1, lessonId, transcriptRevision, sections: {} };
}

export function upsertShadowingSection(
  session: ShadowingScoreSession,
  lessonId: string,
  transcriptRevision: string,
  result: ShadowingSectionResult,
): ShadowingScoreSession {
  if (session.lessonId !== lessonId || session.transcriptRevision !== transcriptRevision)
    throw new Error('Shadowing session identity mismatch');
  return {
    ...session,
    sections: { ...session.sections, [result.sectionId]: result },
    summary: undefined,
  };
}

export function aggregateShadowingScores(
  session: ShadowingScoreSession,
  totalSections: number,
): ShadowingAggregate | null {
  const results = Object.values(session.sections);
  if (!results.length) return null;
  const average = (field: 'score' | 'contentScore' | 'timingScore') =>
    results.reduce((sum, result) => sum + result[field], 0) / results.length;
  return {
    score: Math.round(average('score')),
    scoredSections: results.length,
    totalSections,
    averageContentScore: Math.round(average('contentScore')),
    averageTimingScore: Math.round(average('timingScore')),
  };
}

function topStrings(values: string[], limit = 5) {
  const counts = new Map<string, number>();
  for (const value of values.filter(Boolean)) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
}

export function shadowingSummarySignals(
  session: ShadowingScoreSession,
  totalSections: number,
): ShadowingSummarySignals | null {
  const aggregate = aggregateShadowingScores(session, totalSections);
  if (!aggregate) return null;
  const results = Object.values(session.sections);
  const substitutions = new Map<string, { expected: string; heard: string; count: number }>();
  for (const result of results)
    for (const item of result.substitutions) {
      const key = JSON.stringify([item.expected, item.heard]);
      const previous = substitutions.get(key);
      substitutions.set(key, {
        expected: item.expected,
        heard: item.heard,
        count: (previous?.count ?? 0) + 1,
      });
    }
  const ordered = [...results].sort((a, b) => a.score - b.score || a.sectionId.localeCompare(b.sectionId));
  const faster = results.filter((result) => result.relativeSpeakingSpeed > 1.18).length;
  const slower = results.filter((result) => result.relativeSpeakingSpeed < 0.85).length;
  const fingerprint = results
    .slice()
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId))
    .map((r) => [r.sectionId, r.score, r.contentScore, r.timingScore, r.missing.length, r.substitutions.length, r.additions.length].join(':'))
    .join('|');
  return {
    ...aggregate,
    fingerprint,
    pace: { faster, slower, close: results.length - faster - slower },
    commonDeletions: topStrings(results.flatMap((result) => result.missing)),
    commonAdditions: topStrings(results.flatMap((result) => result.additions)),
    commonSubstitutions: [...substitutions.values()]
      .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected))
      .slice(0, 5),
    highest: ordered.slice(-3).reverse().map(({ sectionId, score }) => ({ sectionId, score })),
    lowest: ordered.slice(0, 3).map(({ sectionId, score }) => ({ sectionId, score })),
  };
}

export function fallbackShadowingSummary(signals: ShadowingSummarySignals): Omit<ShadowingSessionSummary, 'fingerprint'> {
  const wentWell =
    signals.averageContentScore >= 85 && signals.averageTimingScore >= 80
      ? 'Your speech was generally recognised accurately and your pacing stayed close to the reference.'
      : signals.averageContentScore >= signals.averageTimingScore
        ? 'Your wording was generally more consistent than your pacing.'
        : 'Your pacing was generally more consistent than the recognised wording.';
  const keepWorking =
    signals.commonDeletions.length || signals.commonSubstitutions.length
      ? 'Keep sentence endings and any repeatedly missed sounds clear while staying with the speaker’s rhythm.'
      : signals.pace.slower > signals.pace.faster
        ? 'Try carrying the rhythm forward a little more smoothly on slower attempts.'
        : signals.pace.faster
          ? 'Give faster attempts a little more space so each phrase stays clear.'
          : 'Keep repeating the lower-scoring sections while preserving the same steady timing.';
  return { provider: 'fallback', wentWell, keepWorking };
}

const STORAGE_PREFIX = 'hibiki:shadowing:v1:';

function validResult(value: unknown): value is ShadowingSectionResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ShadowingSectionResult>;
  const score = (v: unknown) =>
    typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
  const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
  const strings = (v: unknown, maxItems = 500) =>
    Array.isArray(v) &&
    v.length <= maxItems &&
    v.every((item) => typeof item === 'string' && item.length <= 220);
  return (
    r.schemaVersion === 1 &&
    typeof r.sectionId === 'string' &&
    !!r.sectionId &&
    r.sectionId.length <= 200 &&
    score(r.score) &&
    score(r.contentScore) &&
    score(r.timingScore) &&
    finite(r.contentSimilarity) &&
    finite(r.timingSimilarity) &&
    finite(r.referenceDurationSeconds) &&
    (r.referenceDurationSeconds as number) > 0 &&
    finite(r.recordingDurationSeconds) &&
    (r.recordingDurationSeconds as number) > 0 &&
    finite(r.relativeSpeakingSpeed) &&
    (r.relativeSpeakingSpeed as number) > 0 &&
    (r.normalization === 'reading' || r.normalization === 'orthographic') &&
    typeof r.targetText === 'string' &&
    r.targetText.length <= 5000 &&
    typeof r.recognizedText === 'string' &&
    r.recognizedText.length <= 5000 &&
    typeof r.targetReading === 'string' &&
    typeof r.recognizedReading === 'string' &&
    Array.isArray(r.alignment) &&
    r.alignment.length <= 500 &&
    strings(r.missing) &&
    strings(r.additions) &&
    Array.isArray(r.substitutions) &&
    r.substitutions.length <= 500 &&
    r.substitutions.every(
      (item) =>
        item &&
        typeof item.expected === 'string' &&
        item.expected.length <= 20 &&
        typeof item.heard === 'string' &&
        item.heard.length <= 20,
    ) &&
    strings(r.suggestions, 3) &&
    typeof r.attemptedAt === 'string' &&
    Number.isFinite(Date.parse(r.attemptedAt))
  );
}

export function loadShadowingSession(lessonId: string, transcriptRevision: string) {
  if (typeof window === 'undefined') return createShadowingSession(lessonId, transcriptRevision);
  try {
    const raw = sessionStorage.getItem(STORAGE_PREFIX + lessonId);
    if (!raw) return createShadowingSession(lessonId, transcriptRevision);
    const parsed = JSON.parse(raw) as Partial<ShadowingScoreSession>;
    if (
      parsed.schemaVersion !== 1 ||
      parsed.lessonId !== lessonId ||
      parsed.transcriptRevision !== transcriptRevision ||
      !parsed.sections ||
      typeof parsed.sections !== 'object'
    )
      return createShadowingSession(lessonId, transcriptRevision);
    const sections = Object.fromEntries(
      Object.entries(parsed.sections).filter(([, result]) => validResult(result)),
    );
    return {
      schemaVersion: 1 as const,
      lessonId,
      transcriptRevision,
      sections,
      ...(parsed.summary &&
      typeof parsed.summary === 'object' &&
      typeof parsed.summary.fingerprint === 'string' &&
      typeof parsed.summary.wentWell === 'string' &&
      typeof parsed.summary.keepWorking === 'string' &&
      (parsed.summary.provider === 'qwen' || parsed.summary.provider === 'fallback')
        ? { summary: parsed.summary }
        : {}),
    };
  } catch {
    return createShadowingSession(lessonId, transcriptRevision);
  }
}

export function saveShadowingSession(session: ShadowingScoreSession) {
  if (typeof window === 'undefined') return false;
  try {
    sessionStorage.setItem(STORAGE_PREFIX + session.lessonId, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
