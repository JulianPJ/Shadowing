import type { QuizGenerationProvider } from '../../types';
import { runWorkersAi, type WorkersAiBindingLike } from '../workers-ai';
import {
  WORKERS_AI_QUIZ_MODEL,
  WORKERS_AI_QUIZ_SELECTOR_MODEL,
  DIRECT_QWEN_MAX_JAPANESE_CHARS,
  QUIZ_RESPONSE_SCHEMA,
  directQuizMessages,
  selectedQuizMessages,
} from './prompts';
import { QuizWindow, quizGenerationRoute, selectQuizWindows } from './selection';
import { QuizProviderError } from './errors';
import { parseChatCompletion } from './chat';
export function createWorkersAiQuizProvider(ai: WorkersAiBindingLike): QuizGenerationProvider {
  return {
    name: `workers-ai:${WORKERS_AI_QUIZ_MODEL}<=${DIRECT_QWEN_MAX_JAPANESE_CHARS};${WORKERS_AI_QUIZ_SELECTOR_MODEL}->${WORKERS_AI_QUIZ_MODEL}`,
    async generate(lesson, signal) {
      let messages: { role: string; content: string }[];
      if (quizGenerationRoute(lesson) === 'direct-qwen') {
        messages = directQuizMessages(lesson);
      } else {
        let windows: QuizWindow[];
        try {
          windows = await selectQuizWindows(ai, lesson, signal);
        } catch {
          throw new QuizProviderError(
            'unavailable',
            'The comprehension check is unavailable right now. Please try again.',
            'selection',
          );
        }
        messages = selectedQuizMessages(windows);
      }

      let response: unknown;
      try {
        response = await runWorkersAi<unknown>(
          ai,
          WORKERS_AI_QUIZ_MODEL,
          {
            messages,
            response_format: { type: 'json_schema', json_schema: QUIZ_RESPONSE_SCHEMA },
            max_completion_tokens: 3000,
            temperature: 0.2,
          },
          signal,
        );
      } catch {
        throw new QuizProviderError(
          'unavailable',
          'The comprehension check is unavailable right now. Please try again.',
          'provider-call',
        );
      }
      try {
        return parseChatCompletion(response);
      } catch {
        throw new QuizProviderError(
          'malformed',
          'We could not make a reliable check from this response. Please try again.',
          'provider-response',
        );
      }
    },
  };
}
