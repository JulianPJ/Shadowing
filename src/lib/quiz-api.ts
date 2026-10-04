import { validateQuizLesson, QuizValidationError } from './quiz';
import { generateLessonQuiz, QuizProviderError, readBoundedJson } from './providers/quiz';
import type { QuizGenerationProvider } from './types';

export async function handleQuizRequest(request: Request, provider?: QuizGenerationProvider) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Open this check from your lesson.' }, { status: 403, headers });
  }

  let lesson;
  try {
    lesson = validateQuizLesson(await readBoundedJson(request, 350000));
  } catch (error) {
    return Response.json(
      { code: 'invalid-transcript', error: error instanceof QuizValidationError ? error.message : 'A valid lesson transcript is required.' },
      { status: 400, headers },
    );
  }

  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const quiz = provider
      ? await generateLessonQuiz(lesson, signal, provider)
      : await generateLessonQuiz(lesson, signal);
    return Response.json({ quiz }, { headers });
  } catch (error) {
    const code = error instanceof QuizProviderError ? error.code : 'unavailable';
    const stage = error instanceof QuizProviderError ? error.stage ?? 'unknown' : 'unknown';
    const reason = error instanceof QuizProviderError ? error.reason : undefined;
    // Never log transcript, upstream response, endpoint, credentials or model output.
    console.warn(JSON.stringify({ event: 'quiz-generation-failed', code, stage, reason, segmentCount: lesson.segments.length }));
    return Response.json(
      {
        code,
        error: error instanceof QuizProviderError
          ? error.message
          : 'The comprehension check took too long or is unavailable. Please try again; you can keep practicing.',
      },
      { status: code === 'malformed' ? 502 : code === 'insufficient-transcript' ? 422 : 503, headers },
    );
  }
}
