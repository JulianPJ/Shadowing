import { readBoundedJson } from '../../http-json';
export { readBoundedJson } from '../../http-json';
import { object } from '../../transcript-validation';
import type { QuizGenerationProvider } from '../../types';
import { directQuizMessages } from './prompts';
import { QuizProviderError } from './errors';

export function parseChatCompletion(data: unknown): unknown {
  const parsed = object(data);
  if (parsed.response && typeof parsed.response === 'object' && !Array.isArray(parsed.response))
    return parsed.response;
  if (!Array.isArray(parsed.choices) || !parsed.choices.length) throw new Error('Missing choices');
  const choice = object(parsed.choices[0]);
  if (choice.finish_reason !== 'stop') throw new Error('Incomplete response');
  const content = object(choice.message).content;
  if (typeof content !== 'string') throw new Error('Missing content');
  return JSON.parse(content);
}

// Generic OpenAI-compatible provider retained for local development or future alternate hosts.
export const chatCompletionQuizProvider: QuizGenerationProvider = {
  name: 'chat-completions',
  async generate(lesson, signal) {
    const endpoint = process.env.QUIZ_API_URL,
      token = process.env.QUIZ_API_KEY,
      model = process.env.QUIZ_MODEL;
    if (!endpoint || !token || !model)
      throw new QuizProviderError(
        'unconfigured',
        'Comprehension checks are not available for this lesson yet. Your practice is saved.',
        'configuration',
      );
    const url = new URL(endpoint);
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new QuizProviderError(
        'unconfigured',
        'Comprehension checks are not configured yet.',
        'configuration',
      );
    const response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: directQuizMessages(lesson),
      }),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new QuizProviderError(
        'unavailable',
        'The comprehension check is unavailable right now. Please try again.',
        'provider-call',
      );
    }
    try {
      return parseChatCompletion(await readBoundedJson(response, 100000));
    } catch {
      throw new QuizProviderError(
        'malformed',
        'We could not make a reliable check from this response. Please try again.',
        'provider-response',
      );
    }
  },
};
