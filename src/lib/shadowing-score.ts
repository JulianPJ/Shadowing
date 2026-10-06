import { hiragana } from './japanese-readings';

export const SHADOWING_SCORE_VERSION = 1 as const;
export const SHADOWING_SCORE_CONSTANTS = {
  contentWeight: 0.8,
  timingWeight: 0.2,
  timingToleranceRatio: 1.1,
  timingZeroCreditRatio: 2.5,
  minimumRecordingSeconds: 0.45,
  minimumDurationRatio: 0.25,
  maximumAlignmentUnits: 500,
} as const;

export type ShadowingAlignmentOperation = {
  type: 'match' | 'substitution' | 'deletion' | 'insertion';
  expected?: string;
  heard?: string;
};

export type ShadowingAttemptAnalysis = {
  schemaVersion: 1;
  normalization: 'reading' | 'orthographic';
  targetText: string;
  recognizedText: string;
  targetReading: string;
  recognizedReading: string;
  alignment: ShadowingAlignmentOperation[];
  missing: string[];
  substitutions: { expected: string; heard: string }[];
  additions: string[];
  contentSimilarity: number;
  contentScore: number;
  timingSimilarity: number;
  timingScore: number;
  score: number;
  referenceDurationSeconds: number;
  recordingDurationSeconds: number;
  relativeSpeakingSpeed: number;
};

export type ShadowingSectionResult = ShadowingAttemptAnalysis & {
  sectionId: string;
  attemptedAt: string;
  suggestions: string[];
};

/** Consecutive recognizer alignment units, grouped only for readable diagnostics. */
export function shadowingAlignmentChunks(alignment: ShadowingAlignmentOperation[]) {
  const chunks: ShadowingAlignmentOperation[] = [];
  for (const operation of alignment) {
    const previous = chunks.at(-1);
    if (previous?.type === operation.type) {
      if (operation.expected) previous.expected = (previous.expected ?? '') + operation.expected;
      if (operation.heard) previous.heard = (previous.heard ?? '') + operation.heard;
    } else chunks.push({ ...operation });
  }
  return chunks;
}

export class ShadowingScoreError extends Error {
  constructor(
    public code: 'invalid-target' | 'no-speech' | 'recording-too-short' | 'analysis-too-large',
    message: string,
  ) {
    super(message);
  }
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

export function normalizeJapaneseForScoring(text: string) {
  return hiragana(
    text
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\p{P}\p{Z}\s]/gu, ''),
  );
}

export function moraLikeUnits(text: string) {
  const normalized = normalizeJapaneseForScoring(text);
  const smallKana = new Set(Array.from('ゃゅょぁぃぅぇぉゎゕゖ'));
  const units: string[] = [];
  for (const char of Array.from(normalized)) {
    if (smallKana.has(char) && units.length) units[units.length - 1] += char;
    else units.push(char);
  }
  return units;
}

function align(expected: string[], heard: string[]) {
  const width = heard.length + 1;
  const size = (expected.length + 1) * width;
  const costs = new Uint16Array(size);
  const ops = new Uint8Array(size); // 1=diag, 2=deletion, 3=insertion
  const at = (i: number, j: number) => i * width + j;
  for (let i = 1; i <= expected.length; i++) {
    costs[at(i, 0)] = i;
    ops[at(i, 0)] = 2;
  }
  for (let j = 1; j <= heard.length; j++) {
    costs[at(0, j)] = j;
    ops[at(0, j)] = 3;
  }
  for (let i = 1; i <= expected.length; i++) {
    for (let j = 1; j <= heard.length; j++) {
      const substitution = costs[at(i - 1, j - 1)] + (expected[i - 1] === heard[j - 1] ? 0 : 1);
      const deletion = costs[at(i - 1, j)] + 1;
      const insertion = costs[at(i, j - 1)] + 1;
      const best = Math.min(substitution, deletion, insertion);
      costs[at(i, j)] = best;
      // Prefer diagonal ties, then deletion, for stable and human-readable alignment.
      ops[at(i, j)] = substitution === best ? 1 : deletion === best ? 2 : 3;
    }
  }
  const result: ShadowingAlignmentOperation[] = [];
  let i = expected.length;
  let j = heard.length;
  while (i || j) {
    const op = ops[at(i, j)];
    if (op === 1) {
      const same = expected[i - 1] === heard[j - 1];
      result.push({
        type: same ? 'match' : 'substitution',
        expected: expected[i - 1],
        heard: heard[j - 1],
      });
      i--;
      j--;
    } else if (op === 2) {
      result.push({ type: 'deletion', expected: expected[i - 1] });
      i--;
    } else {
      result.push({ type: 'insertion', heard: heard[j - 1] });
      j--;
    }
  }
  return { distance: costs[at(expected.length, heard.length)], alignment: result.reverse() };
}

function grouped(
  alignment: ShadowingAlignmentOperation[],
  type: 'deletion' | 'insertion',
  field: 'expected' | 'heard',
) {
  const groups: string[] = [];
  let current = '';
  for (const operation of alignment) {
    if (operation.type === type) current += operation[field] ?? '';
    else if (current) {
      groups.push(current);
      current = '';
    }
  }
  if (current) groups.push(current);
  return groups;
}

export type ShadowingPaceBand = 'faster' | 'slower' | 'close';

export function shadowingPaceBand(relativeSpeakingSpeed: number): ShadowingPaceBand {
  if (relativeSpeakingSpeed > 1.18) return 'faster';
  if (relativeSpeakingSpeed < 0.85) return 'slower';
  return 'close';
}

export function timingSimilarity(
  recordingDurationSeconds: number,
  referenceDurationSeconds: number,
) {
  const ratio = recordingDurationSeconds / referenceDurationSeconds;
  const deviation = Math.abs(Math.log(ratio));
  const tolerance = Math.log(SHADOWING_SCORE_CONSTANTS.timingToleranceRatio);
  const zeroAt = Math.log(SHADOWING_SCORE_CONSTANTS.timingZeroCreditRatio);
  if (deviation <= tolerance) return 1;
  return clamp01(1 - (deviation - tolerance) / (zeroAt - tolerance));
}

export function scoreShadowingAttempt(input: {
  targetText: string;
  recognizedText: string;
  targetReading?: string;
  recognizedReading?: string;
  referenceDurationSeconds: number;
  recordingDurationSeconds: number;
}): ShadowingAttemptAnalysis {
  const {
    targetText,
    recognizedText,
    referenceDurationSeconds,
    recordingDurationSeconds,
    targetReading,
    recognizedReading,
  } = input;
  if (
    !Number.isFinite(referenceDurationSeconds) ||
    referenceDurationSeconds <= 0 ||
    !normalizeJapaneseForScoring(targetText)
  )
    throw new ShadowingScoreError('invalid-target', 'This section cannot be scored reliably.');
  if (
    !Number.isFinite(recordingDurationSeconds) ||
    recordingDurationSeconds < SHADOWING_SCORE_CONSTANTS.minimumRecordingSeconds ||
    recordingDurationSeconds / referenceDurationSeconds <
      SHADOWING_SCORE_CONSTANTS.minimumDurationRatio
  )
    throw new ShadowingScoreError(
      'recording-too-short',
      'That recording is too short for a reliable match. Try the full section again.',
    );

  const useReadings = !!targetReading && !!recognizedReading;
  const expectedText = useReadings ? targetReading : targetText;
  const heardText = useReadings ? recognizedReading : recognizedText;
  const expected = moraLikeUnits(expectedText);
  const heard = moraLikeUnits(heardText);
  if (!heard.length)
    throw new ShadowingScoreError(
      'no-speech',
      'No meaningful Japanese speech was recognised. Try again a little closer to the microphone.',
    );
  if (
    expected.length > SHADOWING_SCORE_CONSTANTS.maximumAlignmentUnits ||
    heard.length > SHADOWING_SCORE_CONSTANTS.maximumAlignmentUnits
  )
    throw new ShadowingScoreError(
      'analysis-too-large',
      'This section is too long for reliable shadowing scoring.',
    );

  const { distance, alignment } = align(expected, heard);
  const contentSimilarity = clamp01(1 - distance / Math.max(1, expected.length));
  const timing = timingSimilarity(recordingDurationSeconds, referenceDurationSeconds);
  const score = Math.round(
    100 *
      (contentSimilarity * SHADOWING_SCORE_CONSTANTS.contentWeight +
        timing * SHADOWING_SCORE_CONSTANTS.timingWeight),
  );

  return {
    schemaVersion: SHADOWING_SCORE_VERSION,
    normalization: useReadings ? 'reading' : 'orthographic',
    targetText,
    recognizedText,
    targetReading: normalizeJapaneseForScoring(expectedText),
    recognizedReading: normalizeJapaneseForScoring(heardText),
    alignment,
    missing: grouped(alignment, 'deletion', 'expected'),
    substitutions: alignment
      .filter((item) => item.type === 'substitution')
      .map((item) => ({ expected: item.expected ?? '', heard: item.heard ?? '' })),
    additions: grouped(alignment, 'insertion', 'heard'),
    contentSimilarity,
    contentScore: Math.round(contentSimilarity * 100),
    timingSimilarity: timing,
    timingScore: Math.round(timing * 100),
    score: Math.max(0, Math.min(100, score)),
    referenceDurationSeconds,
    recordingDurationSeconds,
    relativeSpeakingSpeed: referenceDurationSeconds / recordingDurationSeconds,
  };
}

export function shadowingScoreLabel(score: number) {
  if (score >= 92) return 'Excellent match.';
  if (score >= 80) return 'Very close.';
  if (score >= 65) return 'Close.';
  if (score >= 45) return 'Getting there.';
  return 'Keep working on this one.';
}

export function fallbackShadowingSuggestions(analysis: ShadowingAttemptAnalysis) {
  const suggestions: string[] = [];
  if (analysis.contentScore >= 94)
    suggestions.push('Your speech was recognised very close to the target wording.');
  else if (analysis.missing.length)
    suggestions.push(
      'Some expected sounds were not recognised clearly. Try keeping the sentence ending audible.',
    );
  else if (analysis.substitutions.length)
    suggestions.push(
      'A few sounds were recognised differently from the target. Try the sentence once more in smaller chunks.',
    );
  else if (analysis.additions.length)
    suggestions.push(
      'A few extra sounds were recognised. Aim for the same compact phrasing as the reference.',
    );

  const pace = shadowingPaceBand(analysis.relativeSpeakingSpeed);
  if (pace === 'faster')
    suggestions.push(
      'Your attempt was faster than the reference. Give each phrase a little more space.',
    );
  else if (pace === 'slower')
    suggestions.push(
      'Your attempt was slower than the reference. Try carrying the rhythm through the whole section.',
    );
  else if (analysis.timingScore >= 90)
    suggestions.push('Your overall pacing was close to the reference timing.');

  if (!suggestions.length)
    suggestions.push('Try it once more while matching both the wording and the speaker’s rhythm.');
  return suggestions.slice(0, 3);
}
