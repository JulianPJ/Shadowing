// Server-only adapter; never imported by client components.
import demo from '../../data/demo.json';
import demoDifficulty from '../../data/demo-difficulty.json';
import {
  calculateSpeechSpeed,
  createDifficultyAnalysis,
  fullDifficultyTranscript,
} from '../difficulty';
import { transcriptRevision } from '../transcript';
import { object } from '../transcript-validation';
import type { DifficultyAnalysisProvider, QuizLesson } from '../types';
import { runWorkersAi, WORKERS_AI_DECISION_MODEL, type WorkersAiBindingLike } from './workers-ai';

export const WORKERS_AI_DIFFICULTY_MODEL = WORKERS_AI_DECISION_MODEL;
export class DifficultyProviderError extends Error {
  constructor(
    public code: 'unavailable' | 'malformed' | 'insufficient-transcript',
    message: string,
    public stage?: 'provider-call' | 'provider-response' | 'validation',
    public reason?: string,
  ) {
    super(message);
  }
}
const UNAVAILABLE = 'Difficulty analysis is unavailable right now. Please try again.';
const MALFORMED = 'We could not make a reliable difficulty estimate. Please try again.';
const MAX_DECISION_CHARS = 40000;

const QUESTIONS = {
  overall: {
    type: 'choice',
    instructions:
      'Classify the dominant Japanese difficulty of this transcript for a learner. Judge the material as a whole, not the single hardest sentence.',
    criteria: {
      n5_plus: 'Very basic Japanese at or easier than typical JLPT N5 material.',
      n5_n4: 'Beginner Japanese spanning typical JLPT N5 to N4 material.',
      n4_n3: 'Lower-intermediate Japanese spanning typical JLPT N4 to N3 material.',
      n3_n2: 'Intermediate to upper-intermediate Japanese spanning typical JLPT N3 to N2 material.',
      n2_n1: 'Advanced Japanese spanning typical JLPT N2 to N1 material.',
      n1_plus:
        'Very advanced, highly nuanced or specialized Japanese beyond typical JLPT N1 demands.',
    },
  },
  vocabulary: {
    type: 'choice',
    instructions: 'Classify the dominant vocabulary difficulty in this Japanese transcript.',
    criteria: {
      beginner: 'Basic, concrete, very high-frequency vocabulary.',
      elementary: 'Common everyday vocabulary with some variety.',
      intermediate: 'Broader, more abstract, idiomatic or topic-specific vocabulary.',
      advanced: 'Dense, specialized, uncommon or nuanced vocabulary.',
      native: 'Native-level lexical density, nuance, slang, idiom or specialist terminology.',
    },
  },
  grammar: {
    type: 'choice',
    instructions: 'Classify the dominant grammar difficulty in this Japanese transcript.',
    criteria: {
      beginner: 'Simple beginner sentence patterns and particles.',
      elementary: 'Common elementary grammar, tense/aspect and straightforward clause linking.',
      intermediate:
        'Regular intermediate structures, subordination, conditions, ellipsis or sentence chaining.',
      advanced:
        'Complex advanced grammar, dense syntax, nuanced modality or difficult clause relationships.',
      native: 'Highly nuanced native-level grammar and discourse structure.',
    },
  },
  conversation: {
    type: 'choice',
    instructions:
      'Classify the dominant conversational complexity in this Japanese transcript. Consider omission, references, colloquial speech, implied meaning and discourse shifts.',
    criteria: {
      beginner: 'Simple, explicit utterances with little omitted or implied context.',
      elementary: 'Everyday connected speech with mostly explicit meaning.',
      intermediate:
        'Natural conversation with some omission, references, inference, fillers or topic development.',
      advanced:
        'Implicit, colloquial, fast-changing or discourse-heavy conversation with substantial context dependence.',
      native:
        'Highly implicit, culturally dense, nuanced native discourse requiring strong pragmatic knowledge.',
    },
  },
} as const;

type Dimension = keyof typeof QUESTIONS;
type ParsedChoice = { choice: string; confidence: number; probabilities: Record<string, number> };

function splitFullTranscript(text: string): string[] {
  if (text.length <= MAX_DECISION_CHARS) return [text];
  const lines = text.split('\n').filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (line.length > MAX_DECISION_CHARS) {
      if (current) {
        chunks.push(current);
        current = '';
      }
      for (let i = 0; i < line.length; i += MAX_DECISION_CHARS)
        chunks.push(line.slice(i, i + MAX_DECISION_CHARS));
      continue;
    }
    const next = current ? `${current}\n${line}` : line;
    if (next.length > MAX_DECISION_CHARS) {
      chunks.push(current);
      current = line;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function parseChoice(value: unknown): ParsedChoice {
  const raw = object(value);
  if (
    raw.type !== 'choice' ||
    typeof raw.choice !== 'string' ||
    typeof raw.confidence !== 'number' ||
    !Number.isFinite(raw.confidence) ||
    raw.confidence < 0 ||
    raw.confidence > 1
  )
    throw new Error('Invalid choice response');
  const probabilities = object(raw.probabilities),
    parsed: Record<string, number> = {};
  for (const [key, probability] of Object.entries(probabilities)) {
    if (
      typeof probability !== 'number' ||
      !Number.isFinite(probability) ||
      probability < 0 ||
      probability > 1
    )
      throw new Error('Invalid probability');
    parsed[key] = probability;
  }
  if (!(raw.choice in parsed)) throw new Error('Choice missing from probabilities');
  return { choice: raw.choice, confidence: raw.confidence, probabilities: parsed };
}

function parseDecisionResponse(value: unknown): Record<Dimension, ParsedChoice> {
  const raw = object(value),
    answers = object(raw.answers);
  return {
    overall: parseChoice(answers.overall),
    vocabulary: parseChoice(answers.vocabulary),
    grammar: parseChoice(answers.grammar),
    conversation: parseChoice(answers.conversation),
  };
}

function aggregate(results: { weight: number; answers: Record<Dimension, ParsedChoice> }[]) {
  const output: Record<string, string> = {},
    confidence: Record<string, number> = {};
  for (const dimension of Object.keys(QUESTIONS) as Dimension[]) {
    const totals = new Map<string, number>();
    let weightTotal = 0,
      confidenceTotal = 0;
    for (const result of results) {
      weightTotal += result.weight;
      confidenceTotal += result.answers[dimension].confidence * result.weight;
      for (const [choice, probability] of Object.entries(result.answers[dimension].probabilities))
        totals.set(choice, (totals.get(choice) ?? 0) + probability * result.weight);
    }
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (!ranked.length || weightTotal <= 0) throw new Error('No decision probabilities');
    output[dimension] = ranked[0][0];
    confidence[dimension] = Math.max(0, Math.min(1, confidenceTotal / weightTotal));
  }
  return {
    overall: output.overall,
    vocabulary: output.vocabulary,
    grammar: output.grammar,
    conversation: output.conversation,
    confidence,
  };
}

export function createWorkersAiDifficultyProvider(
  ai: WorkersAiBindingLike,
): DifficultyAnalysisProvider {
  return {
    name: `workers-ai:${WORKERS_AI_DIFFICULTY_MODEL}`,
    async analyze(input, signal) {
      const chunks = splitFullTranscript(input.japanese);
      try {
        const results = [];
        for (const chunk of chunks) {
          const response = await runWorkersAi<unknown>(
            ai,
            WORKERS_AI_DIFFICULTY_MODEL,
            {
              model: 'clef-flash',
              state: chunk,
              questions: QUESTIONS,
            },
            signal,
          );
          results.push({
            weight: Math.max(1, Array.from(chunk).length),
            answers: parseDecisionResponse(response),
          });
        }
        return aggregate(results);
      } catch {
        if (signal.aborted)
          throw new DifficultyProviderError('unavailable', UNAVAILABLE, 'provider-call');
        throw new DifficultyProviderError('malformed', MALFORMED, 'provider-response');
      }
    },
  };
}

export async function generateLessonDifficulty(
  lesson: QuizLesson,
  signal: AbortSignal,
  provider?: DifficultyAnalysisProvider,
) {
  const speed = calculateSpeechSpeed(lesson.segments);
  if (speed.japaneseCharacters < 40 || lesson.segments.length < 2)
    throw new DifficultyProviderError(
      'insufficient-transcript',
      'There is not enough Japanese transcript for a useful difficulty estimate.',
    );
  let output: unknown;
  if (lesson.id === demo.id && transcriptRevision(lesson) === transcriptRevision(demo))
    output = demoDifficulty;
  else {
    if (!provider) throw new DifficultyProviderError('unavailable', UNAVAILABLE);
    output = await provider.analyze(fullDifficultyTranscript(lesson), signal);
  }
  try {
    return await createDifficultyAnalysis(output, lesson);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Invalid analysis.';
    throw new DifficultyProviderError('malformed', MALFORMED, 'validation', reason);
  }
}
