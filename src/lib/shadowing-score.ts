import { hiragana, type JapaneseReadingToken } from './japanese-readings';

export const SHADOWING_SCORE_VERSION = 1;
export const SHADOWING_CONTENT_WEIGHT = 0.8;
export const SHADOWING_TIMING_WEIGHT = 0.2;
export const SHADOWING_INSERTION_COST = 0.75;
export const SHADOWING_DELETION_COST = 1;
export const SHADOWING_SUBSTITUTION_COST = 1;
export const SHADOWING_TIMING_GRACE_RATIO = 1.1;
export const SHADOWING_TIMING_ZERO_RATIO = 2;
export const SHADOWING_MIN_SPEECH_SECONDS = 0.35;
export const SHADOWING_MIN_DURATION_RATIO = 0.25;
export const SHADOWING_MIN_CONTENT_RATIO = 0.2;

export type ShadowingAlignmentOperation = {
  type: 'match' | 'substitution' | 'deletion' | 'insertion';
  target?: string;
  heard?: string;
};

export type ShadowingPace = 'faster' | 'close' | 'slower';

export type ShadowingScoreAnalysis = {
  schemaVersion: 1;
  targetText: string;
  recognizedText: string;
  targetReading: string;
  recognizedReading: string;
  score: number;
  contentScore: number;
  timingScore: number;
  contentSimilarity: number;
  timingSimilarity: number;
  targetDuration: number;
  speechDuration: number;
  durationRatio: number;
  pace: ShadowingPace;
  alignment: ShadowingAlignmentOperation[];
  matches: number;
  deletions: number;
  substitutions: number;
  insertions: number;
  targetUnits: number;
  recognizedUnits: number;
  suggestions: string[];
};

export type ShadowingInvalidReason =
  | 'empty-target'
  | 'no-speech'
  | 'too-short'
  | 'invalid-timing';

export type ShadowingScoreResult =
  | { valid: true; analysis: ShadowingScoreAnalysis }
  | { valid: false; reason: ShadowingInvalidReason; message: string };

export type ScoredShadowingSection = {
  sectionId: string;
  attemptId: string;
  scoredAt: string;
  analysis: ShadowingScoreAnalysis;
};

export type ShadowingAggregate = {
  score: number;
  scoredSections: number;
  totalSections: number;
  averageContentScore: number;
  averageTimingScore: number;
  deletions: number;
  substitutions: number;
  insertions: number;
  fasterSections: number;
  slowerSections: number;
  closePaceSections: number;
  lowestSections: Array<{ sectionId: string; score: number }>;
  highestSections: Array<{ sectionId: string; score: number }>;
};

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

export function readingText(
  text: string,
  tokens: readonly JapaneseReadingToken[] = [{ text }],
): string {
  const reconstructed = tokens.map((token) => token.text).join('');
  const source = reconstructed === text ? tokens : [{ text }];
  return source.map((token) => token.reading || token.text).join('');
}

export function normalizeJapanesePronunciation(text: string): string {
  return hiragana(text.normalize('NFKC'))
    .toLowerCase()
    .replace(/[ゐヰ]/g, 'い')
    .replace(/[ゑヱ]/g, 'え')
    .replace(/[\p{P}\p{S}\p{Z}\s]/gu, '');
}

const SMALL_KANA = /^[ゃゅょぁぃぅぇぉゎゕゖ]$/;

export function moraUnits(text: string): string[] {
  const normalized = normalizeJapanesePronunciation(text);
  const units: string[] = [];
  for (const char of Array.from(normalized)) {
    if (SMALL_KANA.test(char) && units.length) units[units.length - 1] += char;
    else units.push(char);
  }
  return units;
}

export function alignPronunciation(
  target: readonly string[],
  heard: readonly string[],
): { cost: number; operations: ShadowingAlignmentOperation[] } {
  const rows = target.length + 1;
  const cols = heard.length + 1;
  const cost = Array.from({ length: rows }, () => Array<number>(cols).fill(0));
  const step = Array.from({ length: rows }, () =>
    Array<ShadowingAlignmentOperation['type'] | null>(cols).fill(null),
  );
  for (let i = 1; i < rows; i++) {
    cost[i][0] = cost[i - 1][0] + SHADOWING_DELETION_COST;
    step[i][0] = 'deletion';
  }
  for (let j = 1; j < cols; j++) {
    cost[0][j] = cost[0][j - 1] + SHADOWING_INSERTION_COST;
    step[0][j] = 'insertion';
  }
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const same = target[i - 1] === heard[j - 1];
      const diagonal = cost[i - 1][j - 1] + (same ? 0 : SHADOWING_SUBSTITUTION_COST);
      const deletion = cost[i - 1][j] + SHADOWING_DELETION_COST;
      const insertion = cost[i][j - 1] + SHADOWING_INSERTION_COST;
      const best = Math.min(diagonal, deletion, insertion);
      cost[i][j] = best;
      // Stable tie-break: preserve aligned speech first, then target deletions, then additions.
      step[i][j] =
        diagonal === best ? (same ? 'match' : 'substitution') : deletion === best ? 'deletion' : 'insertion';
    }
  }
  const operations: ShadowingAlignmentOperation[] = [];
  let i = target.length;
  let j = heard.length;
  while (i > 0 || j > 0) {
    const type = step[i][j] ?? (i > 0 ? 'deletion' : 'insertion');
    if (type === 'match' || type === 'substitution') {
      operations.push({ type, target: target[i - 1], heard: heard[j - 1] });
      i--;
      j--;
    } else if (type === 'deletion') {
      operations.push({ type, target: target[i - 1] });
      i--;
    } else {
      operations.push({ type, heard: heard[j - 1] });
      j--;
    }
  }
  operations.reverse();
  return { cost: cost[target.length][heard.length], operations };
}

export function timingSimilarity(durationRatio: number): number {
  if (!Number.isFinite(durationRatio) || durationRatio <= 0) return 0;
  const deviation = Math.abs(Math.log2(durationRatio));
  const grace = Math.log2(SHADOWING_TIMING_GRACE_RATIO);
  if (deviation <= grace) return 1;
  const zero = Math.log2(SHADOWING_TIMING_ZERO_RATIO);
  return clamp(1 - (deviation - grace) / (zero - grace));
}

function paceFromRatio(durationRatio: number): ShadowingPace {
  if (durationRatio > SHADOWING_TIMING_GRACE_RATIO) return 'slower';
  if (durationRatio < 1 / SHADOWING_TIMING_GRACE_RATIO) return 'faster';
  return 'close';
}

function fallbackSuggestions(analysis: Omit<ShadowingScoreAnalysis, 'suggestions'>): string[] {
  const suggestions: string[] = [];
  if (analysis.deletions)
    suggestions.push(
      analysis.deletions === 1
        ? 'One part of the target was not recognised clearly. Try keeping every mora audible.'
        : 'Several parts of the target were not recognised clearly. Try a slower, complete repetition first.',
    );
  if (analysis.substitutions)
    suggestions.push('Some sounds were recognised differently from the target. Replay the section and copy the sound sequence closely.');
  if (analysis.insertions)
    suggestions.push('The recording included extra recognised sounds. Try matching the speaker without adding fillers.');
  if (analysis.pace === 'slower')
    suggestions.push('Your recognised speech ran slower than the source. Try keeping the phrase moving with the speaker.');
  else if (analysis.pace === 'faster')
    suggestions.push('Your recognised speech ran faster than the source. Try settling into the speaker’s timing.');
  if (!suggestions.length)
    suggestions.push('Very close. Repeat once more and keep the same wording and rhythm.');
  return suggestions.slice(0, 3);
}

export function scoreShadowingAttempt(input: {
  targetText: string;
  recognizedText: string;
  targetReading?: string;
  recognizedReading?: string;
  targetDuration: number;
  speechDuration: number;
}): ShadowingScoreResult {
  const targetReading = input.targetReading || input.targetText;
  const recognizedReading = input.recognizedReading || input.recognizedText;
  const target = moraUnits(targetReading);
  const heard = moraUnits(recognizedReading);
  if (!target.length)
    return { valid: false, reason: 'empty-target', message: 'This section has no scorable Japanese speech.' };
  if (
    !Number.isFinite(input.targetDuration) ||
    !Number.isFinite(input.speechDuration) ||
    input.targetDuration <= 0 ||
    input.speechDuration < 0
  )
    return { valid: false, reason: 'invalid-timing', message: 'The recording timing could not be measured reliably. Please try again.' };
  if (!heard.length || input.speechDuration < SHADOWING_MIN_SPEECH_SECONDS)
    return { valid: false, reason: 'no-speech', message: 'No meaningful Japanese speech was recognised. Please record the section again.' };

  const durationRatio = input.speechDuration / input.targetDuration;
  if (
    durationRatio < SHADOWING_MIN_DURATION_RATIO &&
    heard.length / target.length < SHADOWING_MIN_CONTENT_RATIO
  )
    return { valid: false, reason: 'too-short', message: 'That recording was too short to score reliably. Try the full section again.' };

  const { cost, operations } = alignPronunciation(target, heard);
  const contentSimilarity = clamp(1 - cost / target.length);
  const timing = timingSimilarity(durationRatio);
  const contentScore = Math.round(contentSimilarity * 100);
  const timingScore = Math.round(timing * 100);
  const score = Math.round(
    100 * (contentSimilarity * SHADOWING_CONTENT_WEIGHT + timing * SHADOWING_TIMING_WEIGHT),
  );
  const counts = operations.reduce(
    (total, operation) => {
      total[operation.type]++;
      return total;
    },
    { match: 0, deletion: 0, substitution: 0, insertion: 0 },
  );
  const base: Omit<ShadowingScoreAnalysis, 'suggestions'> = {
    schemaVersion: SHADOWING_SCORE_VERSION,
    targetText: input.targetText,
    recognizedText: input.recognizedText,
    targetReading: normalizeJapanesePronunciation(targetReading),
    recognizedReading: normalizeJapanesePronunciation(recognizedReading),
    score,
    contentScore,
    timingScore,
    contentSimilarity,
    timingSimilarity: timing,
    targetDuration: input.targetDuration,
    speechDuration: input.speechDuration,
    durationRatio,
    pace: paceFromRatio(durationRatio),
    alignment: operations,
    matches: counts.match,
    deletions: counts.deletion,
    substitutions: counts.substitution,
    insertions: counts.insertion,
    targetUnits: target.length,
    recognizedUnits: heard.length,
  };
  return { valid: true, analysis: { ...base, suggestions: fallbackSuggestions(base) } };
}

export function aggregateShadowingScores(
  sections: readonly ScoredShadowingSection[],
  totalSections: number,
): ShadowingAggregate | null {
  if (!sections.length) return null;
  const latest = new Map<string, ScoredShadowingSection>();
  for (const section of sections) latest.set(section.sectionId, section);
  const values = [...latest.values()];
  const mean = (numbers: number[]) => numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  const ranked = values
    .map(({ sectionId, analysis }) => ({ sectionId, score: analysis.score }))
    .sort((a, b) => a.score - b.score || a.sectionId.localeCompare(b.sectionId));
  return {
    score: Math.round(mean(values.map((value) => value.analysis.score))),
    scoredSections: values.length,
    totalSections: Math.max(values.length, totalSections),
    averageContentScore: Math.round(mean(values.map((value) => value.analysis.contentScore))),
    averageTimingScore: Math.round(mean(values.map((value) => value.analysis.timingScore))),
    deletions: values.reduce((sum, value) => sum + value.analysis.deletions, 0),
    substitutions: values.reduce((sum, value) => sum + value.analysis.substitutions, 0),
    insertions: values.reduce((sum, value) => sum + value.analysis.insertions, 0),
    fasterSections: values.filter((value) => value.analysis.pace === 'faster').length,
    slowerSections: values.filter((value) => value.analysis.pace === 'slower').length,
    closePaceSections: values.filter((value) => value.analysis.pace === 'close').length,
    lowestSections: ranked.slice(0, 3),
    highestSections: ranked.slice(-3).reverse(),
  };
}

export function withShadowingSuggestions(
  analysis: ShadowingScoreAnalysis,
  suggestions: readonly string[],
): ShadowingScoreAnalysis {
  const clean = suggestions
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3);
  return clean.length ? { ...analysis, suggestions: clean } : analysis;
}


export function shadowingSummaryFallback(aggregate: ShadowingAggregate) {
  const whatWentWell =
    aggregate.averageContentScore >= 85 && aggregate.closePaceSections >= aggregate.scoredSections / 2
      ? 'Your speech was generally recognised accurately and your pacing stayed close to the source.'
      : aggregate.averageContentScore >= aggregate.averageTimingScore
        ? 'Recognition was the stronger part of this session, with several sections matching the target closely.'
        : 'Your timing was the stronger part of this session, with several attempts staying close to the speaker’s pace.';
  let keepWorkingOn = 'Keep repeating the lowest-scoring sections and aim for a complete, steady match.';
  if (aggregate.deletions + aggregate.substitutions > aggregate.insertions && aggregate.deletions + aggregate.substitutions > 0)
    keepWorkingOn = 'Some target sounds were missed or recognised differently. Replay the lowest-scoring sections and keep each mora clear.';
  if (aggregate.slowerSections > aggregate.closePaceSections)
    keepWorkingOn = 'Several attempts were slower than the source. Keep the wording clear while moving with the speaker’s rhythm.';
  else if (aggregate.fasterSections > aggregate.closePaceSections)
    keepWorkingOn = 'Several attempts were faster than the source. Ease back slightly and settle into the speaker’s timing.';
  return { whatWentWell, keepWorkingOn };
}
