import { object } from '../transcript-validation';
import { QUESTION_KINDS } from '../quiz';
import { readStorage } from '../storage';
import type { QuizAttempt, QuizAnswerResult } from '../types';
// Existing quiz history is the sole source. Validate portable attempts even when
// the old lesson/quiz revision is no longer present; never duplicate their content.
export function loadQuizHistory(): QuizAttempt[] {
  const values = readStorage<unknown>('quiz-attempts', []);
  if (!Array.isArray(values)) return [];
  const results: QuizAttempt[] = [];
  const date = (v: unknown): v is string =>
    typeof v === 'string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
  const text = (v: unknown, max = 200) => typeof v === 'string' && v.length > 0 && v.length <= max;
  for (const value of values) {
    try {
      const r = object(value);
      if (
        r.schemaVersion !== 1 ||
        r.quizAttempted !== true ||
        !text(r.id) ||
        !text(r.lessonId) ||
        !text(r.quizId) ||
        typeof r.transcriptKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(r.transcriptKey) ||
        (r.videoId !== undefined && !text(r.videoId, 100)) ||
        !date(r.startedAt) ||
        !date(r.updatedAt) ||
        r.updatedAt < r.startedAt ||
        (r.completedAt !== null &&
          (!date(r.completedAt) || r.completedAt < r.startedAt || r.completedAt > r.updatedAt)) ||
        !Number.isInteger(r.totalQuestions) ||
        (r.totalQuestions as number) < 3 ||
        (r.totalQuestions as number) > 7 ||
        !Array.isArray(r.results) ||
        r.results.length > (r.totalQuestions as number) ||
        (r.completedAt && r.results.length !== r.totalQuestions)
      )
        continue;
      const answers: QuizAnswerResult[] = r.results.map((value, i) => {
        const a = object(value),
          e = object(a.evidence);
        if (
          a.questionId !== `question-${i + 1}` ||
          !QUESTION_KINDS.includes(a.kind as QuizAnswerResult['kind']) ||
          ![0, 1, 2, 3].includes(a.selectedIndex as number) ||
          ![0, 1, 2, 3].includes(a.correctIndex as number) ||
          a.correct !== (a.selectedIndex === a.correctIndex) ||
          !Array.isArray(e.segmentIds) ||
          !e.segmentIds.length ||
          e.segmentIds.length > 24 ||
          !e.segmentIds.every((id) => text(id)) ||
          new Set(e.segmentIds).size !== e.segmentIds.length ||
          !text(e.quote, 120000) ||
          typeof e.start !== 'number' ||
          typeof e.end !== 'number' ||
          !Number.isFinite(e.start) ||
          !Number.isFinite(e.end) ||
          e.start < 0 ||
          e.end <= e.start ||
          e.end > 86400
        )
          throw new Error('Invalid quiz result');
        return {
          questionId: a.questionId,
          kind: a.kind,
          selectedIndex: a.selectedIndex,
          correctIndex: a.correctIndex,
          correct: a.correct,
          evidence: { segmentIds: e.segmentIds, quote: e.quote, start: e.start, end: e.end },
        } as QuizAnswerResult;
      });
      if (r.score !== answers.filter((a) => a.correct).length) continue;
      results.push({
        schemaVersion: 1,
        id: r.id,
        lessonId: r.lessonId,
        ...(r.videoId ? { videoId: r.videoId } : {}),
        quizId: r.quizId,
        transcriptKey: r.transcriptKey,
        quizAttempted: true,
        startedAt: r.startedAt,
        updatedAt: r.updatedAt,
        completedAt: r.completedAt,
        score: r.score,
        totalQuestions: r.totalQuestions,
        results: answers,
      } as QuizAttempt);
    } catch {
      /* One malformed attempt does not hide valid retakes. */
    }
  }
  return results;
}
