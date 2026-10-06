import type { ShadowingSectionResult } from './shadowing-score';
import { readStorage, storageAccount, writeStorage } from './storage/browser';

export type ShadowingRecentAttempt = Pick<
  ShadowingSectionResult,
  | 'attemptedAt'
  | 'score'
  | 'contentScore'
  | 'timingScore'
  | 'referenceDurationSeconds'
  | 'recordingDurationSeconds'
>;
export const MAX_RECENT_SHADOWING_ATTEMPTS = 8;

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
  recentAttempts?: Record<string, ShadowingRecentAttempt[]>;
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
    recentAttempts: {
      ...session.recentAttempts,
      [result.sectionId]: [
        ...(session.recentAttempts?.[result.sectionId] ??
          (session.sections[result.sectionId]
            ? [recentAttempt(session.sections[result.sectionId])]
            : [])),
        recentAttempt(result),
      ].slice(-MAX_RECENT_SHADOWING_ATTEMPTS),
    },
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
  const ordered = [...results].sort(
    (a, b) => a.score - b.score || a.sectionId.localeCompare(b.sectionId),
  );
  const faster = results.filter((result) => result.relativeSpeakingSpeed > 1.18).length;
  const slower = results.filter((result) => result.relativeSpeakingSpeed < 0.85).length;
  const fingerprint = results
    .slice()
    .sort((a, b) => a.sectionId.localeCompare(b.sectionId))
    .map((r) =>
      [
        r.sectionId,
        r.score,
        r.contentScore,
        r.timingScore,
        r.missing.length,
        r.substitutions.length,
        r.additions.length,
      ].join(':'),
    )
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
    highest: ordered
      .slice(-3)
      .reverse()
      .map(({ sectionId, score }) => ({ sectionId, score })),
    lowest: ordered.slice(0, 3).map(({ sectionId, score }) => ({ sectionId, score })),
  };
}

export function fallbackShadowingSummary(
  signals: ShadowingSummarySignals,
): Omit<ShadowingSessionSummary, 'fingerprint'> {
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
const HISTORY_KEY = 'shadowing:history';
export const MAX_SHADOWING_HISTORY_BYTES = 1024 * 1024;

/** Bounded local history identity; canonical transcript hashes and score version are unchanged. */
export function compactShadowingRevision(revision: string) {
  const hashes = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  for (let i = 0; i < revision.length; i++) {
    const code = revision.charCodeAt(i);
    for (let j = 0; j < hashes.length; j++)
      hashes[j] = Math.imul(hashes[j] ^ code, 0x01000193 + j * 2) >>> 0;
  }
  return `local-v1:${revision.length}:${hashes.map((n) => n.toString(16).padStart(8, '0')).join('')}`;
}

function recentAttempt(result: ShadowingRecentAttempt): ShadowingRecentAttempt {
  const {
    attemptedAt,
    score,
    contentScore,
    timingScore,
    referenceDurationSeconds,
    recordingDurationSeconds,
  } = result;
  return {
    attemptedAt,
    score,
    contentScore,
    timingScore,
    referenceDurationSeconds,
    recordingDurationSeconds,
  };
}

function validRecentAttempt(value: unknown): value is ShadowingRecentAttempt {
  if (!value || typeof value !== 'object') return false;
  const r = value as ShadowingRecentAttempt;
  return (
    typeof r.attemptedAt === 'string' &&
    Number.isFinite(Date.parse(r.attemptedAt)) &&
    [r.score, r.contentScore, r.timingScore].every(
      (n) => Number.isInteger(n) && n >= 0 && n <= 100,
    ) &&
    [r.referenceDurationSeconds, r.recordingDurationSeconds].every(
      (n) => Number.isFinite(n) && n > 0 && n <= 86400,
    )
  );
}

/** Compact recognition evidence only. Recordings and recognised text never enter durable history. */
export function loadAllShadowingSessions(): ShadowingScoreSession[] {
  const raw = readStorage<unknown>(HISTORY_KEY, []);
  if (!Array.isArray(raw)) return [];
  return raw.slice(-24).flatMap((value): ShadowingScoreSession[] => {
    if (!value || typeof value !== 'object') return [];
    const s = value as ShadowingScoreSession;
    if (
      s.schemaVersion !== 1 ||
      typeof s.lessonId !== 'string' ||
      !s.lessonId ||
      s.lessonId.length > 200 ||
      typeof s.transcriptRevision !== 'string' ||
      !/^local-v1:\d{1,7}:[a-f0-9]{32}$/.test(s.transcriptRevision) ||
      !s.recentAttempts ||
      typeof s.recentAttempts !== 'object' ||
      Array.isArray(s.recentAttempts)
    )
      return [];
    const recentAttempts = Object.fromEntries(
      Object.entries(s.recentAttempts)
        .slice(-200)
        .flatMap(([id, attempts]) => {
          if (!id || id.length > 200 || !Array.isArray(attempts)) return [];
          const valid = attempts
            .filter(validRecentAttempt)
            .slice(-MAX_RECENT_SHADOWING_ATTEMPTS)
            .map(recentAttempt);
          return valid.length ? [[id, valid]] : [];
        }),
    );
    return [
      {
        schemaVersion: 1,
        lessonId: s.lessonId,
        transcriptRevision: s.transcriptRevision,
        sections: {},
        recentAttempts,
      },
    ];
  });
}

export function shadowingSectionTrend(attempts: ShadowingRecentAttempt[] = []) {
  if (attempts.length < 2) return null;
  const latest = attempts.at(-1)!;
  // Playback speed changes alter the reference duration; compare equivalent-speed attempts only.
  const comparable = attempts.filter(
    (a) => Math.abs(a.referenceDurationSeconds - latest.referenceDurationSeconds) < 0.01,
  );
  if (comparable.length < 2) return null;
  const difference = latest.score - comparable[0].score;
  return {
    attempts: comparable.length,
    difference,
    label:
      difference > 0
        ? `Up ${difference} points`
        : difference < 0
          ? `Down ${Math.abs(difference)} points`
          : 'Steady match',
  };
}

function validResult(value: unknown): value is ShadowingSectionResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as Partial<ShadowingSectionResult>;
  const score = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 100;
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
    r.targetReading.length <= 5000 &&
    typeof r.recognizedReading === 'string' &&
    r.recognizedReading.length <= 5000 &&
    Array.isArray(r.alignment) &&
    r.alignment.length <= 500 &&
    r.alignment.every(
      (item) =>
        item &&
        ['match', 'substitution', 'deletion', 'insertion'].includes(item.type) &&
        (item.expected === undefined ||
          (typeof item.expected === 'string' && item.expected.length <= 20)) &&
        (item.heard === undefined || (typeof item.heard === 'string' && item.heard.length <= 20)),
    ) &&
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
  const history = loadAllShadowingSessions().find(
    (s) =>
      s.lessonId === lessonId &&
      s.transcriptRevision === compactShadowingRevision(transcriptRevision),
  );
  const empty = {
    ...createShadowingSession(lessonId, transcriptRevision),
    recentAttempts: history?.recentAttempts ?? {},
  };
  try {
    const raw = sessionStorage.getItem(legacyKey(lessonId));
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<ShadowingScoreSession>;
    if (
      parsed.schemaVersion !== 1 ||
      parsed.lessonId !== lessonId ||
      parsed.transcriptRevision !== transcriptRevision ||
      !parsed.sections ||
      typeof parsed.sections !== 'object'
    )
      return empty;
    const sections = Object.fromEntries(
      Object.entries(parsed.sections).filter(([, result]) => validResult(result)),
    );
    return {
      schemaVersion: 1 as const,
      lessonId,
      transcriptRevision,
      sections,
      recentAttempts:
        history?.recentAttempts ??
        Object.fromEntries(Object.entries(sections).map(([id, r]) => [id, [recentAttempt(r)]])),
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
    return empty;
  }
}

function legacyKey(lessonId: string) {
  const account = storageAccount();
  return STORAGE_PREFIX + (account ? `account:${account}:` : '') + lessonId;
}

export function saveShadowingSession(session: ShadowingScoreSession) {
  if (typeof window === 'undefined') return false;
  const revision = compactShadowingRevision(session.transcriptRevision);
  const histories = loadAllShadowingSessions().filter(
    (s) => s.lessonId !== session.lessonId || s.transcriptRevision !== revision,
  );
  const recentAttempts = Object.fromEntries(
    Object.entries(session.recentAttempts ?? {}).slice(-200),
  );
  const records = [
    ...histories,
    {
      schemaVersion: 1 as const,
      lessonId: session.lessonId,
      transcriptRevision: revision,
      sections: {},
      recentAttempts,
    },
  ].slice(-24);
  while (
    records.length &&
    new TextEncoder().encode(JSON.stringify(records)).byteLength > MAX_SHADOWING_HISTORY_BYTES
  )
    records.shift();
  const saved = writeStorage(HISTORY_KEY, records);
  try {
    sessionStorage.setItem(legacyKey(session.lessonId), JSON.stringify(session));
    return saved;
  } catch {
    return false;
  }
}
