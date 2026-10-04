import { validateQuizLesson, QuizValidationError } from './quiz';
import { generateLessonQuiz, QuizProviderError, readBoundedJson } from './providers/quiz';
import type { QuizGenerationProvider } from './types';
import { requestEnvelope } from './content-request';
import { QUIZ_GENERATOR_VERSION } from './generated-artifacts';
import { trustedContent, loadSharedArtifact, saveSharedArtifact, noSharedContent, type SharedContentDependencies } from './shared-content';

export async function handleQuizRequest(request: Request, provider?: QuizGenerationProvider, storage: SharedContentDependencies = noSharedContent) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return Response.json({ error: 'Open this check from your lesson.' }, { status: 403, headers });
  }

  let lesson; let contentKey;
  try {
    const envelope = requestEnvelope(await readBoundedJson(request, 350000));
    lesson = validateQuizLesson(envelope.lesson); contentKey = envelope.contentKey;
  } catch (error) {
    return Response.json(
      { code: 'invalid-transcript', error: error instanceof QuizValidationError ? error.message : 'A valid lesson transcript is required.' },
      { status: 400, headers },
    );
  }

  try {
    const trusted = await trustedContent(contentKey, lesson, 'quiz', QUIZ_GENERATOR_VERSION, storage);
    const cached = await loadSharedArtifact(trusted, lesson, storage);
    if (cached) return Response.json({ quiz: cached }, { headers: { ...headers, 'X-Hibiki-Cache': 'hit' } });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(45000)]);
    const quiz = provider
      ? await generateLessonQuiz(lesson, signal, provider)
      : await generateLessonQuiz(lesson, signal);
    await saveSharedArtifact(trusted, quiz, storage);
    return Response.json({ quiz }, { headers: { ...headers, 'X-Hibiki-Cache': trusted ? 'miss' : 'bypass' } });
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
