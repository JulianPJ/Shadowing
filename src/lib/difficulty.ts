import { transcriptKey, validateQuizLesson } from './transcript';
import { object } from './transcript-validation';
import type {
  ContentDifficultyAnalysis,
  DifficultyAnalysisInput,
  DifficultyDimension,
  DifficultyLevel,
  JlptLevel,
  QuizLesson,
  Segment,
  SpeechSpeed,
} from './types';

export class DifficultyValidationError extends Error {}
const LANGUAGE_LABELS = ['Beginner', 'Elementary', 'Intermediate', 'Advanced', 'Native'];
type DifficultyBand = 'n5_plus' | 'n5_n4' | 'n4_n3' | 'n3_n2' | 'n2_n1' | 'n1_plus';
type DifficultyClass = 'beginner' | 'elementary' | 'intermediate' | 'advanced' | 'native';
const BANDS: Record<DifficultyBand, { min: JlptLevel; max: JlptLevel; label: string }> = {
  n5_plus: { min: 'N5', max: 'N5', label: 'N5+' },
  n5_n4: { min: 'N5', max: 'N4', label: 'N5–N4' },
  n4_n3: { min: 'N4', max: 'N3', label: 'N4–N3' },
  n3_n2: { min: 'N3', max: 'N2', label: 'N3–N2' },
  n2_n1: { min: 'N2', max: 'N1', label: 'N2–N1' },
  n1_plus: { min: 'N1', max: 'N1', label: 'N1+' },
};
const CLASSES: DifficultyClass[] = ['beginner', 'elementary', 'intermediate', 'advanced', 'native'];

export function validateDifficultyLesson(value: unknown): QuizLesson {
  return validateQuizLesson(value, { maxSegments: 10000, maxCharacters: 300000 });
}
function strict(value: unknown, fields: string[]) {
  const raw = object(value);
  if (Object.keys(raw).some((key) => !fields.includes(key)) || fields.some((key) => !(key in raw)))
    throw new DifficultyValidationError('Invalid fields.');
  return raw;
}
function level(value: unknown): DifficultyLevel {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5)
    throw new DifficultyValidationError('Invalid difficulty level.');
  return value as DifficultyLevel;
}
function japaneseCount(value: string) {
  return (
    value.normalize('NFKC').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/gu) ||
    []
  ).length;
}
const round = (n: number) => Math.round(n * 10) / 10;

// Caption pace, not mora count or audio-level voice activity detection. Assumes normalized segments.
export function calculateSpeechSpeed(segments: Segment[]): SpeechSpeed {
  let japaneseCharacters = 0,
    activeSeconds = 0,
    excludedGapSeconds = 0,
    previousEnd: number | null = null,
    spokenSegments = 0;
  for (const s of segments) {
    const count = japaneseCount(s.japanese);
    if (
      !count ||
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end) ||
      s.start < 0 ||
      s.end <= s.start ||
      (previousEnd !== null && s.start < previousEnd)
    )
      continue;
    const gap = previousEnd === null ? 0 : s.start - previousEnd;
    if (gap <= 1) activeSeconds += gap;
    else excludedGapSeconds += gap;
    activeSeconds += s.end - s.start;
    japaneseCharacters += count;
    previousEnd = s.end;
    spokenSegments++;
  }
  const enough = japaneseCharacters >= 40 && activeSeconds >= 10 && spokenSegments >= 2;
  const value = enough ? round((japaneseCharacters * 60) / activeSeconds) : null;
  const pace =
    value === null
      ? null
      : value < 180
        ? 1
        : value < 260
          ? 2
          : value < 340
            ? 3
            : value < 420
              ? 4
              : 5;
  return {
    metricVersion: 1,
    value,
    unit: 'Japanese characters/min',
    level: pace,
    label:
      pace === null
        ? 'Not enough timing data'
        : ['Slow', 'Moderate', 'Natural', 'Fast', 'Very fast'][pace - 1],
    explanation: enough
      ? 'Estimated from Japanese caption characters over captioned speaking time at original playback speed.'
      : 'At least two Japanese sections, 40 Japanese characters and 10 seconds of captioned time are needed for a useful pace estimate.',
    japaneseCharacters,
    activeSeconds: round(activeSeconds),
    excludedGapSeconds: round(excludedGapSeconds),
  };
}

// Semantic classification uses the complete normalized Japanese transcript. No IDs,
// timestamps, lesson metadata, translations or learner data are sent to the model.
export function fullDifficultyTranscript(lesson: QuizLesson): DifficultyAnalysisInput {
  const japanese = lesson.segments
    .map((segment) => segment.japanese.trim())
    .filter(Boolean)
    .join('\n');
  const totalCharacters = Array.from(japanese.replace(/\n/g, '')).length;
  return {
    japanese,
    coverage: {
      strategyVersion: 2,
      totalSegments: lesson.segments.length,
      sampledSegments: lesson.segments.length,
      totalCharacters,
      sampledCharacters: totalCharacters,
    },
  };
}
// Kept as a compatibility export for older imports; this no longer samples.
export const sampleDifficultyTranscript = fullDifficultyTranscript;

function confidence(value: unknown): 'low' | 'medium' | 'high' {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1)
    throw new DifficultyValidationError('Invalid confidence.');
  return value < 0.15 ? 'low' : value < 0.4 ? 'medium' : 'high';
}
function classification(value: unknown): DifficultyClass {
  if (typeof value !== 'string' || !CLASSES.includes(value as DifficultyClass))
    throw new DifficultyValidationError('Invalid difficulty classification.');
  return value as DifficultyClass;
}
function dimension(value: DifficultyClass): DifficultyDimension {
  const numeric = (CLASSES.indexOf(value) + 1) as DifficultyLevel;
  return {
    level: numeric,
    label: LANGUAGE_LABELS[numeric - 1],
    explanation: 'Classified from the full Japanese transcript.',
    examples: [],
  };
}
function semantic(value: unknown) {
  const raw = strict(value, ['overall', 'vocabulary', 'grammar', 'conversation', 'confidence']);
  const band = raw.overall;
  if (typeof band !== 'string' || !(band in BANDS))
    throw new DifficultyValidationError('Invalid JLPT band.');
  const b = BANDS[band as DifficultyBand];
  const confidenceRaw = strict(raw.confidence, [
    'overall',
    'vocabulary',
    'grammar',
    'conversation',
  ]);
  return {
    overall: {
      jlptMin: b.min,
      jlptMax: b.max,
      label: `Approximately ${b.label}`,
      explanation: 'Classified from the full Japanese transcript.',
      confidence: confidence(confidenceRaw.overall),
    },
    vocabulary: dimension(classification(raw.vocabulary)),
    grammar: dimension(classification(raw.grammar)),
    conversationalComplexity: dimension(classification(raw.conversation)),
  };
}
export async function createDifficultyAnalysis(
  value: unknown,
  lesson: QuizLesson,
): Promise<ContentDifficultyAnalysis> {
  lesson = validateDifficultyLesson(lesson);
  const parts = semantic(value),
    key = await transcriptKey(lesson),
    coverage = fullDifficultyTranscript(lesson).coverage;
  return {
    schemaVersion: 1,
    id: `difficulty:v1:${lesson.id}:${key}`,
    lessonId: lesson.id,
    transcriptKey: key,
    generatedAt: new Date().toISOString(),
    ...parts,
    speechSpeed: calculateSpeechSpeed(lesson.segments),
    coverage,
  };
}
function equalRecord(value: unknown, expected: object) {
  const raw = strict(value, Object.keys(expected));
  if (Object.entries(expected).some(([key, expectedValue]) => raw[key] !== expectedValue))
    throw new DifficultyValidationError('Invalid deterministic metrics.');
}
function validateStoredDimension(value: unknown): DifficultyDimension {
  const raw = strict(value, ['level', 'label', 'explanation', 'examples']);
  const numeric = level(raw.level);
  if (
    raw.label !== LANGUAGE_LABELS[numeric - 1] ||
    raw.explanation !== 'Classified from the full Japanese transcript.' ||
    !Array.isArray(raw.examples) ||
    raw.examples.length !== 0
  )
    throw new DifficultyValidationError('Invalid stored classification.');
  return {
    level: numeric,
    label: raw.label as string,
    explanation: raw.explanation as string,
    examples: [],
  };
}
export async function validateDifficultyAnalysis(
  value: unknown,
  lesson: QuizLesson,
): Promise<ContentDifficultyAnalysis> {
  lesson = validateDifficultyLesson(lesson);
  const raw = strict(value, [
    'schemaVersion',
    'id',
    'lessonId',
    'transcriptKey',
    'generatedAt',
    'overall',
    'vocabulary',
    'grammar',
    'speechSpeed',
    'conversationalComplexity',
    'coverage',
  ]);
  const key = await transcriptKey(lesson),
    id = `difficulty:v1:${lesson.id}:${key}`;
  if (
    raw.schemaVersion !== 1 ||
    raw.lessonId !== lesson.id ||
    raw.transcriptKey !== key ||
    raw.id !== id
  )
    throw new DifficultyValidationError('Stale analysis.');
  if (
    typeof raw.generatedAt !== 'string' ||
    !Number.isFinite(Date.parse(raw.generatedAt)) ||
    new Date(raw.generatedAt).toISOString() !== raw.generatedAt
  )
    throw new DifficultyValidationError('Invalid date.');
  const expectedCoverage = fullDifficultyTranscript(lesson).coverage,
    speechSpeed = calculateSpeechSpeed(lesson.segments);
  equalRecord(raw.coverage, expectedCoverage);
  equalRecord(raw.speechSpeed, speechSpeed);

  const overall = strict(raw.overall, ['jlptMin', 'jlptMax', 'label', 'explanation', 'confidence']);
  const matchingBand = Object.values(BANDS).find(
    (b) =>
      b.min === overall.jlptMin &&
      b.max === overall.jlptMax &&
      `Approximately ${b.label}` === overall.label,
  );
  if (
    !matchingBand ||
    overall.explanation !== 'Classified from the full Japanese transcript.' ||
    !['low', 'medium', 'high'].includes(overall.confidence as string)
  )
    throw new DifficultyValidationError('Invalid stored overall classification.');

  return {
    schemaVersion: 1,
    id,
    lessonId: lesson.id,
    transcriptKey: key,
    generatedAt: raw.generatedAt,
    overall: {
      jlptMin: overall.jlptMin as JlptLevel,
      jlptMax: overall.jlptMax as JlptLevel,
      label: overall.label as string,
      explanation: overall.explanation as string,
      confidence: overall.confidence as 'low' | 'medium' | 'high',
    },
    vocabulary: validateStoredDimension(raw.vocabulary),
    grammar: validateStoredDimension(raw.grammar),
    speechSpeed,
    conversationalComplexity: validateStoredDimension(raw.conversationalComplexity),
    coverage: expectedCoverage,
  };
}
