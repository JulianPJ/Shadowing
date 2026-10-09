import { object } from '../../transcript-validation';
import type { QuestionKind, QuizLesson, Segment } from '../../types';
import { runWorkersAi, type WorkersAiBindingLike } from '../workers-ai';
import {
  WORKERS_AI_QUIZ_SELECTOR_MODEL,
  DIRECT_QWEN_MAX_JAPANESE_CHARS,
  QUESTION_TYPES,
} from './config';
export type CompactSegment = Pick<Segment, 'id' | 'japanese'>;

export type QuizWindow = { id: string; index: number; start: number; segments: CompactSegment[] };

export type WindowEvaluation = {
  window: QuizWindow;
  suitability: number;
  selfContained: number;
  kind: QuestionKind;
  score: number;
};

export function compactSegments(lesson: QuizLesson): CompactSegment[] {
  return lesson.segments.map(({ id, japanese }) => ({ id, japanese }));
}

export function quizJapaneseCharacterCount(lesson: QuizLesson): number {
  return lesson.segments.reduce(
    (total, segment) => total + Array.from(segment.japanese.replace(/\s/g, '')).length,
    0,
  );
}

export function quizGenerationRoute(lesson: QuizLesson): 'direct-qwen' | 'clef-qwen' {
  return quizJapaneseCharacterCount(lesson) <= DIRECT_QWEN_MAX_JAPANESE_CHARS
    ? 'direct-qwen'
    : 'clef-qwen';
}

export function buildQuizWindows(lesson: QuizLesson): QuizWindow[] {
  const size = 8,
    stride = 6,
    starts = new Set<number>();
  for (let start = 0; start < lesson.segments.length; start += stride)
    starts.add(Math.min(start, Math.max(0, lesson.segments.length - size)));
  starts.add(Math.max(0, lesson.segments.length - size));
  return [...starts]
    .sort((a, b) => a - b)
    .map((start, index) => ({
      id: `window-${index + 1}`,
      index,
      start,
      segments: lesson.segments
        .slice(start, start + size)
        .map(({ id, japanese }) => ({ id, japanese })),
    }));
}

export function selectorQuestions(windows: QuizWindow[]) {
  const questions: Record<string, unknown> = {};
  for (const window of windows) {
    questions[`${window.id}_suitability`] = {
      type: 'score',
      instructions: `How suitable is ${window.id} for creating one grounded multiple-choice Japanese listening-comprehension question?`,
      criteria: [
        'Poor: trivial, fragmented, ambiguous, or lacking a testable idea.',
        'Fair: usable but limited or somewhat dependent on surrounding context.',
        'Good: clear material with a useful fact, relationship, expression or inference.',
        'Excellent: rich material supporting a strong unambiguous question.',
      ],
    };
    questions[`${window.id}_self_contained`] = {
      type: 'noul',
      instructions: `Does ${window.id} contain a useful question anchor, even if a little neighboring transcript context would help?`,
      criteria: {
        true: 'The core meaning needed for a question is present.',
        false: 'The material is too fragmented or context-poor to use.',
      },
    };
    questions[`${window.id}_type`] = {
      type: 'choice',
      instructions: `Which comprehension question type best fits ${window.id}?`,
      criteria: QUESTION_TYPES,
    };
  }
  return questions;
}

export function parseNumber(value: unknown, min: number, max: number) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new Error('Invalid selector number');
  return value;
}

export function parseWindowEvaluations(value: unknown, windows: QuizWindow[]): WindowEvaluation[] {
  const raw = object(value),
    answers = object(raw.answers);
  return windows.map((window) => {
    const suitability = object(answers[`${window.id}_suitability`]);
    const selfContained = object(answers[`${window.id}_self_contained`]);
    const type = object(answers[`${window.id}_type`]);
    if (suitability.type !== 'score' || selfContained.type !== 'noul' || type.type !== 'choice')
      throw new Error('Invalid selector response');
    const scoreValue = parseNumber(suitability.score, 0, 3);
    const selfValue = parseNumber(selfContained.noul, 0, 1);
    if (typeof type.choice !== 'string' || !(type.choice in QUESTION_TYPES))
      throw new Error('Invalid selector type');
    return {
      window,
      suitability: scoreValue,
      selfContained: selfValue,
      kind: type.choice as QuestionKind,
      score: scoreValue + selfValue * 0.75,
    };
  });
}

export function selectDiverseWindowAnchors(
  evaluations: WindowEvaluation[],
  limit = 8,
): QuizWindow[] {
  const ranked = [...evaluations].sort(
    (a, b) =>
      b.score - a.score || b.selfContained - a.selfContained || a.window.index - b.window.index,
  );
  const selected: WindowEvaluation[] = [],
    chosen = new Set<string>();
  const acceptable = ranked.filter((item) => item.suitability >= 1.25 && item.selfContained >= 0.3);
  const source = acceptable.length >= 3 ? acceptable : ranked;

  const add = (item: WindowEvaluation | undefined) => {
    if (!item || selected.length >= limit || chosen.has(item.window.id)) return;
    selected.push(item);
    chosen.add(item.window.id);
  };

  // First preserve broad lesson coverage.
  const regionCount = Math.min(5, Math.max(1, source.length));
  for (let region = 0; region < regionCount && selected.length < limit; region++) {
    add(
      source.find(
        (item) =>
          Math.min(
            regionCount - 1,
            Math.floor((item.window.index * regionCount) / Math.max(1, evaluations.length)),
          ) === region,
      ),
    );
  }

  // Then add useful question-type diversity.
  for (const kind of Object.keys(QUESTION_TYPES) as QuestionKind[])
    add(source.find((item) => item.kind === kind && !chosen.has(item.window.id)));
  for (const item of source) add(item);

  return selected.sort((a, b) => a.window.index - b.window.index).map((item) => item.window);
}

export function expandSelectedWindows(lesson: QuizLesson, anchors: QuizWindow[]): QuizWindow[] {
  const targetSize = 18;
  const result: QuizWindow[] = [];
  const seen = new Set<string>();
  for (const anchor of anchors) {
    const extra = Math.max(0, targetSize - anchor.segments.length);
    const start = Math.max(
      0,
      Math.min(
        anchor.start - Math.floor(extra / 2),
        Math.max(0, lesson.segments.length - targetSize),
      ),
    );
    const segments = lesson.segments
      .slice(start, start + targetSize)
      .map(({ id, japanese }) => ({ id, japanese }));
    const key = segments.map((segment) => segment.id).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ ...anchor, start, segments });
  }
  return result;
}

export async function selectQuizWindows(
  ai: WorkersAiBindingLike,
  lesson: QuizLesson,
  signal: AbortSignal,
): Promise<QuizWindow[]> {
  const windows = buildQuizWindows(lesson),
    evaluated: WindowEvaluation[] = [];
  for (let offset = 0; offset < windows.length; offset += 16) {
    const batch = windows.slice(offset, offset + 16);
    const response = await runWorkersAi<unknown>(
      ai,
      WORKERS_AI_QUIZ_SELECTOR_MODEL,
      {
        model: 'clef-flash',
        state: { windows: batch.map((window) => ({ id: window.id, segments: window.segments })) },
        questions: selectorQuestions(batch),
      },
      signal,
    );
    evaluated.push(...parseWindowEvaluations(response, batch));
  }
  const selected = expandSelectedWindows(lesson, selectDiverseWindowAnchors(evaluated));
  if (!selected.length) throw new Error('No suitable quiz windows');
  return selected;
}
