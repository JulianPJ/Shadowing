import { validateDifficultyLesson } from './difficulty';
import { readBoundedJson } from './providers/quiz';
import { DifficultyProviderError, generateLessonDifficulty } from './providers/difficulty';
import type { DifficultyAnalysisProvider } from './types';

export async function handleDifficultyRequest(request: Request, provider?: DifficultyAnalysisProvider) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Open difficulty details from your lesson.' }, { status: 403, headers });
  let lesson;
  try { lesson = validateDifficultyLesson(await readBoundedJson(request, 1600000)); }
  catch { return Response.json({ code: 'invalid-transcript', error: 'A supported, normalized lesson transcript is required for difficulty analysis.' }, { status: 400, headers }); }
  const started = Date.now();
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30000)]);
    const analysis = await generateLessonDifficulty(lesson, signal, provider);
    return Response.json({ analysis }, { headers });
  } catch (error) {
    const code = error instanceof DifficultyProviderError ? error.code : 'unavailable';
    console.warn(JSON.stringify({ event: 'difficulty-analysis-failed', code, segmentCount: lesson.segments.length, elapsedMs: Date.now() - started }));
    return Response.json({ code, error: error instanceof DifficultyProviderError ? error.message : 'Difficulty analysis is unavailable right now. Please try again.' }, { status: code === 'malformed' ? 502 : code === 'insufficient-transcript' ? 422 : 503, headers });
  }
}
