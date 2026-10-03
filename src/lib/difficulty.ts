import { object, transcriptKey, validateQuizLesson } from './quiz';
import type { ContentDifficultyAnalysis, DifficultyAnalysisInput, DifficultyDimension, DifficultyEvidence, DifficultyLevel, JlptLevel, QuizLesson, Segment, SpeechSpeed } from './types';

export class DifficultyValidationError extends Error {}
const JLPT: JlptLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];
const LANGUAGE_LABELS = ['Basic', 'Elementary', 'Intermediate', 'Advanced', 'Very advanced'];
const CONVERSATION_LABELS = ['Low complexity', 'Some complexity', 'Moderate complexity', 'High complexity', 'Very high complexity'];
export function validateDifficultyLesson(value: unknown): QuizLesson {
  return validateQuizLesson(value, { maxSegments: 10000, maxCharacters: 300000 });
}
function strict(value: unknown, fields: string[]) {
  const raw = object(value);
  if (Object.keys(raw).some(key => !fields.includes(key)) || fields.some(key => !(key in raw))) throw new DifficultyValidationError('Invalid fields.');
  return raw;
}
function text(value: unknown, max = 450): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new DifficultyValidationError('Invalid text.');
  return value.trim();
}
function level(value: unknown): DifficultyLevel {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 5) throw new DifficultyValidationError('Invalid difficulty level.');
  return value as DifficultyLevel;
}
function japaneseCount(text: string) {
  return (text.normalize('NFKC').match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]/gu) || []).length;
}
const round = (n: number) => Math.round(n * 10) / 10;

// Caption pace, not mora count or audio-level voice activity detection. Assumes normalized segments.
export function calculateSpeechSpeed(segments: Segment[]): SpeechSpeed {
  let japaneseCharacters = 0, activeSeconds = 0, excludedGapSeconds = 0, previousEnd: number | null = null, spokenSegments = 0;
  for (const s of segments) {
    const count = japaneseCount(s.japanese);
    if (!count || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < 0 || s.end <= s.start || (previousEnd !== null && s.start < previousEnd)) continue;
    const gap = previousEnd === null ? 0 : s.start - previousEnd;
    if (gap <= 1) activeSeconds += gap;
    else excludedGapSeconds += gap;
    activeSeconds += s.end - s.start; japaneseCharacters += count; previousEnd = s.end; spokenSegments++;
  }
  const enough = japaneseCharacters >= 40 && activeSeconds >= 10 && spokenSegments >= 2;
  const value = enough ? round(japaneseCharacters * 60 / activeSeconds) : null;
  const pace = value === null ? null : (value < 180 ? 1 : value < 260 ? 2 : value < 340 ? 3 : value < 420 ? 4 : 5);
  return {
    metricVersion: 1, value, unit: 'Japanese characters/min', level: pace,
    label: pace === null ? 'Not enough timing data' : ['Slow', 'Moderate', 'Natural conversational', 'Fast', 'Very fast'][pace - 1],
    explanation: enough ? 'Estimated caption pace at original playback speed. Japanese-script characters divided by captioned time plus gaps up to one second; longer gaps are excluded. Caption timing and kanji spelling can affect this estimate.' : 'At least two Japanese sections, 40 Japanese characters and 10 seconds of captioned time are needed for a useful pace estimate.',
    japaneseCharacters, activeSeconds: round(activeSeconds), excludedGapSeconds: round(excludedGapSeconds),
  };
}

// Twelve equally spaced windows of up to three neighboring sections, including both ends.
// Every section excerpt is capped at 250 code points: <=36 sections / 9,000 code points.
export function sampleDifficultyTranscript(lesson: QuizLesson): DifficultyAnalysisInput {
  const segments = lesson.segments, windows: DifficultyAnalysisInput['windows'] = [];
  const seen = new Set<number>();
  const windowCount = Math.min(12, Math.ceil(segments.length / 3));
  for (let i = 0; i < windowCount; i++) {
    const start = windowCount === 1 ? 0 : Math.round(i * Math.max(0, segments.length - 3) / (windowCount - 1));
    const window = [];
    for (let n = start; n < Math.min(start + 3, segments.length); n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      window.push({ id: segments[n].id, japanese: Array.from(segments[n].japanese).slice(0, 250).join('') });
    }
    if (window.length) windows.push(window);
  }
  return { windows, coverage: {
    strategyVersion: 1, totalSegments: segments.length, sampledSegments: seen.size,
    totalCharacters: segments.reduce((n, s) => n + Array.from(s.japanese).length, 0),
    sampledCharacters: windows.flat().reduce((n, s) => n + Array.from(s.japanese).length, 0),
  } };
}
function evidence(value: unknown, lesson: QuizLesson, input: DifficultyAnalysisInput, persisted: boolean): DifficultyEvidence {
  const raw = strict(value, persisted ? ['segmentId', 'quote', 'explanation', 'start', 'end'] : ['segmentId', 'quote', 'explanation']);
  const segmentId = text(raw.segmentId, 200), quote = text(raw.quote, 180);
  const segment = lesson.segments.find(s => s.id === segmentId);
  const sampled = input.windows.flat().find(s => s.id === segmentId);
  if (!segment || !sampled || !segment.japanese.includes(quote) || !sampled.japanese.includes(quote) || !japaneseCount(quote)) throw new DifficultyValidationError('Unsupported evidence.');
  if (persisted && (raw.start !== segment.start || raw.end !== segment.end)) throw new DifficultyValidationError('Invalid evidence timing.');
  return { segmentId, quote, explanation: text(raw.explanation, 240), start: segment.start, end: segment.end };
}
function dimension(value: unknown, lesson: QuizLesson, input: DifficultyAnalysisInput, conversation: boolean, persisted: boolean): DifficultyDimension {
  const raw = strict(value, persisted ? ['level', 'label', 'explanation', 'examples'] : ['level', 'explanation', 'examples']);
  const score = level(raw.level), label = (conversation ? CONVERSATION_LABELS : LANGUAGE_LABELS)[score - 1];
  if (persisted && raw.label !== label) throw new DifficultyValidationError('Invalid label.');
  if (!Array.isArray(raw.examples) || raw.examples.length < 1 || raw.examples.length > 3) throw new DifficultyValidationError('Expected compact evidence.');
  const examples = raw.examples.map(e => evidence(e, lesson, input, persisted));
  if (new Set(examples.map(e => e.quote.normalize('NFKC').replace(/\s/g, ''))).size !== examples.length) throw new DifficultyValidationError('Duplicate evidence.');
  return { level: score, label, explanation: text(raw.explanation), examples };
}
function semantic(value: unknown, lesson: QuizLesson, persisted = false) {
  const input = sampleDifficultyTranscript(lesson);
  const raw = strict(value, ['overall', 'vocabulary', 'grammar', 'conversationalComplexity']);
  const overall = strict(raw.overall, persisted ? ['jlptMin', 'jlptMax', 'label', 'explanation', 'confidence'] : ['jlptMin', 'jlptMax', 'explanation', 'confidence']);
  const min = JLPT.indexOf(overall.jlptMin as JlptLevel), max = JLPT.indexOf(overall.jlptMax as JlptLevel);
  if (min < 0 || max < min) throw new DifficultyValidationError('Invalid JLPT range.');
  if (!['low', 'medium', 'high'].includes(overall.confidence as string)) throw new DifficultyValidationError('Invalid confidence.');
  const label = `Approximately ${JLPT[min]}${min === max ? '' : `–${JLPT[max]}`}`;
  if (persisted && overall.label !== label) throw new DifficultyValidationError('Invalid label.');
  const coverage = input.coverage;
  // Sample coverage and short material limit the strength of the model's claim.
  const confidence = calculateSpeechSpeed(lesson.segments).japaneseCharacters < 200 || coverage.sampledCharacters / coverage.totalCharacters < 0.02 ? 'low' : coverage.sampledCharacters < coverage.totalCharacters && overall.confidence === 'high' ? 'medium' : overall.confidence as 'low' | 'medium' | 'high';
  if (persisted && overall.confidence !== confidence) throw new DifficultyValidationError('Invalid confidence.');
  return {
    overall: { jlptMin: JLPT[min], jlptMax: JLPT[max], label, explanation: text(overall.explanation), confidence },
    vocabulary: dimension(raw.vocabulary, lesson, input, false, persisted),
    grammar: dimension(raw.grammar, lesson, input, false, persisted),
    conversationalComplexity: dimension(raw.conversationalComplexity, lesson, input, true, persisted),
  };
}
export async function createDifficultyAnalysis(value: unknown, lesson: QuizLesson): Promise<ContentDifficultyAnalysis> {
  lesson = validateDifficultyLesson(lesson);
  const parts = semantic(value, lesson), key = await transcriptKey(lesson);
  return { schemaVersion: 1, id: `difficulty:v1:${lesson.id}:${key}`, lessonId: lesson.id, transcriptKey: key, generatedAt: new Date().toISOString(), ...parts, speechSpeed: calculateSpeechSpeed(lesson.segments), coverage: sampleDifficultyTranscript(lesson).coverage };
}
function equalRecord(value: unknown, expected: object) {
  const raw = strict(value, Object.keys(expected));
  if (Object.entries(expected).some(([key, value]) => raw[key] !== value)) throw new DifficultyValidationError('Invalid deterministic metrics.');
}
export async function validateDifficultyAnalysis(value: unknown, lesson: QuizLesson): Promise<ContentDifficultyAnalysis> {
  lesson = validateDifficultyLesson(lesson);
  const raw = strict(value, ['schemaVersion', 'id', 'lessonId', 'transcriptKey', 'generatedAt', 'overall', 'vocabulary', 'grammar', 'speechSpeed', 'conversationalComplexity', 'coverage']);
  const key = await transcriptKey(lesson), id = `difficulty:v1:${lesson.id}:${key}`;
  if (raw.schemaVersion !== 1 || raw.lessonId !== lesson.id || raw.transcriptKey !== key || raw.id !== id) throw new DifficultyValidationError('Stale analysis.');
  if (typeof raw.generatedAt !== 'string' || !Number.isFinite(Date.parse(raw.generatedAt)) || new Date(raw.generatedAt).toISOString() !== raw.generatedAt) throw new DifficultyValidationError('Invalid date.');
  const speechSpeed = calculateSpeechSpeed(lesson.segments), coverage = sampleDifficultyTranscript(lesson).coverage;
  equalRecord(raw.speechSpeed, speechSpeed); equalRecord(raw.coverage, coverage);
  const parts = semantic({ overall: raw.overall, vocabulary: raw.vocabulary, grammar: raw.grammar, conversationalComplexity: raw.conversationalComplexity }, lesson, true);
  return { schemaVersion: 1, id, lessonId: lesson.id, transcriptKey: key, generatedAt: raw.generatedAt, ...parts, speechSpeed, coverage };
}
