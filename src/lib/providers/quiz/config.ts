import type { QuestionKind } from '../../types';
import { WORKERS_AI_DECISION_MODEL, WORKERS_AI_GENERATIVE_MODEL } from '../workers-ai';

export const WORKERS_AI_MODEL = WORKERS_AI_GENERATIVE_MODEL;

export const WORKERS_AI_QUIZ_MODEL = WORKERS_AI_MODEL;

export const WORKERS_AI_QUIZ_SELECTOR_MODEL = WORKERS_AI_DECISION_MODEL;

// Qwen has a 32,768-token context window. Japanese character count is not a token count,
// so keep a conservative product-side ceiling that leaves room for JSON/prompt/output overhead.
export const DIRECT_QWEN_MAX_JAPANESE_CHARS = 12000;

export const MIN_QUIZ_JAPANESE_CHARS = 80;

export const QUESTION_TYPES: Record<QuestionKind, string> = {
  'main-idea': 'Main idea or central point of this window.',
  detail: 'A specific factual detail stated in this window.',
  sequence: 'The order of events or actions in this window.',
  vocabulary: 'Meaning or usage of vocabulary actually present in this window.',
  grammar: 'Meaning or function of grammar actually present in this window.',
  reference: 'What a pronoun, omitted subject, demonstrative or reference points to.',
  intent: 'Speaker intent that is directly supported by the wording.',
  inference: 'A direct inference supported by the window without outside knowledge.',
};
