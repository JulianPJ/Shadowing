import { validateDifficultyLesson } from './difficulty';
import { readBoundedJson } from './providers/quiz';
import { DifficultyProviderError, generateLessonDifficulty } from './providers/difficulty';
import type { DifficultyAnalysisProvider } from './types';
import { requestEnvelope } from './content-request';
import { DIFFICULTY_GENERATOR_VERSION } from './generated-artifacts';
import { trustedContent, loadSharedArtifact, saveSharedArtifact, noSharedContent, type SharedContentDependencies } from './shared-content';

export async function handleDifficultyRequest(request: Request, provider?: DifficultyAnalysisProvider, storage: SharedContentDependencies = noSharedContent) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Open difficulty details from your lesson.' }, { status: 403, headers });
  let lesson; let contentKey;
  try { const envelope = requestEnvelope(await readBoundedJson(request, 1600000)); lesson = validateDifficultyLesson(envelope.lesson); contentKey = envelope.contentKey; }
  catch { return Response.json({ code: 'invalid-transcript', error: 'A supported, normalized lesson transcript is required for difficulty analysis.' }, { status: 400, headers }); }
  const started = Date.now();
  try {
    const trusted = await trustedContent(contentKey, lesson, 'difficulty', DIFFICULTY_GENERATOR_VERSION, storage);
    const cached = await loadSharedArtifact(trusted, lesson, storage);
    if (cached) return Response.json({ analysis: cached }, { headers: { ...headers, 'X-Hibiki-Cache': 'hit' } });
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    const analysis = await generateLessonDifficulty(lesson, signal, provider);
    await saveSharedArtifact(trusted, analysis, storage);
    return Response.json({ analysis }, { headers: { ...headers, 'X-Hibiki-Cache': trusted ? 'miss' : 'bypass' } });
  } catch (error) {
    const code = error instanceof DifficultyProviderError ? error.code : 'unavailable';
    const stage = error instanceof DifficultyProviderError ? error.stage ?? 'unknown' : 'unknown';
    const reason = error instanceof DifficultyProviderError ? error.reason : undefined;
    console.warn(JSON.stringify({ event: 'difficulty-analysis-failed', code, stage, reason, segmentCount: lesson.segments.length, elapsedMs: Date.now() - started }));
    return Response.json({ code, error: error instanceof DifficultyProviderError ? error.message : 'Difficulty analysis is unavailable right now. Please try again.' }, { status: code === 'malformed' ? 502 : code === 'insufficient-transcript' ? 422 : 503, headers });
  }
}
