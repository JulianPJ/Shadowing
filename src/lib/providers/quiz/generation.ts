import demo from '../../../data/demo.json';
import demoQuiz from '../../../data/demo-quiz.json';
import {
  createGeneratedQuiz,
  createQuiz,
  object,
  QuizValidationError,
  transcriptRevision,
} from '../../quiz';
import type { LessonQuiz, QuizGenerationProvider, QuizLesson } from '../../types';
import { MIN_QUIZ_JAPANESE_CHARS } from './prompts';
import { quizJapaneseCharacterCount } from './selection';
import { QuizProviderError } from './errors';
import { chatCompletionQuizProvider } from './chat';
export async function generateLessonQuiz(
  lesson: QuizLesson,
  signal: AbortSignal,
  provider: QuizGenerationProvider = chatCompletionQuizProvider,
): Promise<LessonQuiz> {
  const canonicalDemo =
    lesson.id === demo.id && transcriptRevision(lesson) === transcriptRevision(demo);
  if (
    !canonicalDemo &&
    (lesson.segments.length < 3 || quizJapaneseCharacterCount(lesson) < MIN_QUIZ_JAPANESE_CHARS)
  ) {
    throw new QuizProviderError(
      'insufficient-transcript',
      'This transcript does not contain enough information for a reliable short check. You can keep practicing or try again.',
      'validation',
    );
  }
  try {
    const output = canonicalDemo ? demoQuiz : await provider.generate(lesson, signal);
    const raw = object(output);
    if (Array.isArray(raw.questions) && !raw.questions.length)
      throw new QuizProviderError(
        'malformed',
        'We could not make a reliable check from this response. Please try again.',
        'validation',
        'Model returned no questions.',
      );
    return canonicalDemo
      ? await createQuiz(output, lesson)
      : await createGeneratedQuiz(output, lesson);
  } catch (error) {
    if (error instanceof QuizValidationError)
      throw new QuizProviderError(
        'malformed',
        'We could not make a reliable check from this response. Please try again.',
        'validation',
        error.message,
      );
    throw error;
  }
}
