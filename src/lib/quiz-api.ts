import { readBoundedJson } from './http-json';
import { validateQuizLesson, QuizValidationError } from './quiz';
import { generateLessonQuiz, QuizProviderError } from './providers/quiz';
import type { QuizGenerationProvider } from './types';
import { requestEnvelope } from './content-request';
import { QUIZ_GENERATOR_VERSION } from './generated-artifacts';
import {
  cachedOrGenerateArtifact,
  noSharedContent,
  type SharedContentDependencies,
} from './shared-content';

export async function handleQuizRequest(
  request: Request,
  provider?: QuizGenerationProvider,
  storage: SharedContentDependencies = noSharedContent,
) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Open this check from your lesson.' }, { status: 403, headers });
  }

  let lesson;
  let contentKey;
  try {
    const envelope = requestEnvelope(await readBoundedJson(request, 350000));
    lesson = validateQuizLesson(envelope.lesson);
    contentKey = envelope.contentKey;
  } catch (error) {
    return Response.json(
      {
        code: 'invalid-transcript',
        error:
          error instanceof QuizValidationError
            ? error.message
            : 'A valid lesson transcript is required.',
      },
      { status: 400, headers },
    );
  }

  try {
    const { payload, cache } = await cachedOrGenerateArtifact({
      request,
      lesson,
      contentKey,
      artifactType: 'quiz',
      generatorVersion: QUIZ_GENERATOR_VERSION,
      storage,
      timeoutMs: 45000,
      generate: async (signal) =>
        provider
          ? await generateLessonQuiz(lesson, signal, provider)
          : await generateLessonQuiz(lesson, signal),
    });
    return Response.json({ quiz: payload }, { headers: { ...headers, 'X-Hibiki-Cache': cache } });
  } catch (error) {
    const code = error instanceof QuizProviderError ? error.code : 'unavailable';
    const stage = error instanceof QuizProviderError ? (error.stage ?? 'unknown') : 'unknown';
    const reason = error instanceof QuizProviderError ? error.reason : undefined;
    // Never log transcript, upstream response, endpoint, credentials or model output.
    console.warn(
      JSON.stringify({
        event: 'quiz-generation-failed',
        code,
        stage,
        reason,
        segmentCount: lesson.segments.length,
      }),
    );
    return Response.json(
      {
        code,
        error:
          error instanceof QuizProviderError
            ? error.message
            : 'The comprehension check took too long or is unavailable. Please try again; you can keep practicing.',
      },
      {
        status: code === 'malformed' ? 502 : code === 'insufficient-transcript' ? 422 : 503,
        headers,
      },
    );
  }
}
