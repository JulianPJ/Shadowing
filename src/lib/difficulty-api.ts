import { validateDifficultyLesson } from './difficulty';
import { readBoundedJson } from './http-json';
import { DifficultyProviderError, generateLessonDifficulty } from './providers/difficulty';
import type { DifficultyAnalysisProvider } from './types';
import { requestEnvelope } from './content-request';
import { DIFFICULTY_GENERATOR_VERSION } from './generated-artifacts';
import {
  cachedOrGenerateArtifact,
  noSharedContent,
  type SharedContentDependencies,
} from './shared-content';
import { InferenceDenied } from './server/rate-limit';

export async function handleDifficultyRequest(
  request: Request,
  provider?: DifficultyAnalysisProvider,
  storage: SharedContentDependencies = noSharedContent,
) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin)
    return Response.json(
      { error: 'Open difficulty details from your lesson.' },
      { status: 403, headers },
    );
  let lesson;
  let contentKey;
  try {
    const envelope = requestEnvelope(await readBoundedJson(request, 1600000));
    lesson = validateDifficultyLesson(envelope.lesson);
    contentKey = envelope.contentKey;
  } catch {
    return Response.json(
      {
        code: 'invalid-transcript',
        error: 'A supported, normalized lesson transcript is required for difficulty analysis.',
      },
      { status: 400, headers },
    );
  }
  const started = Date.now();
  try {
    const { payload, cache } = await cachedOrGenerateArtifact({
      request,
      lesson,
      contentKey,
      artifactType: 'difficulty',
      generatorVersion: DIFFICULTY_GENERATOR_VERSION,
      storage,
      timeoutMs: 30000,
      generate: async (signal) => await generateLessonDifficulty(lesson, signal, provider),
    });
    return Response.json(
      { analysis: payload },
      { headers: { ...headers, 'X-Hibiki-Cache': cache } },
    );
  } catch (error) {
    if (error instanceof InferenceDenied) return error.response;
    const code = error instanceof DifficultyProviderError ? error.code : 'unavailable';
    const stage = error instanceof DifficultyProviderError ? (error.stage ?? 'unknown') : 'unknown';
    const reason = error instanceof DifficultyProviderError ? error.reason : undefined;
    console.warn(
      JSON.stringify({
        event: 'difficulty-analysis-failed',
        code,
        stage,
        reason,
        segmentCount: lesson.segments.length,
        elapsedMs: Date.now() - started,
      }),
    );
    return Response.json(
      {
        code,
        error:
          error instanceof DifficultyProviderError
            ? error.message
            : 'Difficulty analysis is unavailable right now. Please try again.',
      },
      {
        status: code === 'malformed' ? 502 : code === 'insufficient-transcript' ? 422 : 503,
        headers,
      },
    );
  }
}
