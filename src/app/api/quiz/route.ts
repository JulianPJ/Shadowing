import { validateQuizLesson, QuizValidationError } from '@/lib/quiz';
import { generateLessonQuiz, QuizProviderError, readBoundedJson } from '@/lib/providers/quiz';

export const maxDuration = 45;
export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' };
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return Response.json({ error: 'Open this check from your lesson.' }, { status: 403, headers });
  let lesson;
  try { lesson = validateQuizLesson(await readBoundedJson(request, 350000)); }
  catch (error) { return Response.json({ code: 'invalid-transcript', error: error instanceof QuizValidationError ? error.message : 'A valid lesson transcript is required.' }, { status: 400, headers }); }
  try {
    const quiz = await generateLessonQuiz(lesson, AbortSignal.any([request.signal, AbortSignal.timeout(35000)]));
    return Response.json({ quiz }, { headers });
  } catch (error) {
    const code = error instanceof QuizProviderError ? error.code : 'unavailable';
    // Never log transcript, upstream response, endpoint or credentials.
    console.warn(JSON.stringify({ event: 'quiz-generation-failed', code }));
    return Response.json({ code, error: error instanceof QuizProviderError ? error.message : 'The comprehension check took too long or is unavailable. Please try again; you can keep practicing.' }, { status: code === 'malformed' ? 502 : code === 'insufficient-transcript' ? 422 : 503, headers });
  }
}
