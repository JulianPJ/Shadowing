import demo from '@/data/demo.json' with { type: 'json' };
import { createQuiz } from '../quiz/document';
import { scoreQuiz, validateAttempt } from '../quiz/attempts';
import demoQuiz from '@/data/demo-quiz.json' with { type: 'json' };
import {
  createD1GeneratedArtifactRepository,
  QUIZ_GENERATOR_VERSION,
} from '../generated-artifacts';
import {
  createD1LinkedTranscriptRepository,
  validateStoredTranscript,
} from '../linked-transcripts';
import { segmentTranscript } from '../segmentation';
import { transcriptKey, validateQuizLesson } from '../transcript';
import { validateQuiz } from '../quiz/document';
import type { D1Database } from '../d1';
import type { LessonQuiz, QuizLesson } from '../types';
import type { SyncedAttempt } from './types';

export async function verifyAttempt(
  attempt: SyncedAttempt,
  db?: D1Database,
): Promise<SyncedAttempt> {
  let lesson: QuizLesson | null = null,
    quiz: LessonQuiz | null = null;
  if (attempt.lessonId === 'demo' && attempt.transcriptKey === (await transcriptKey(demo))) {
    lesson = demo;
    quiz = { ...(await createQuiz(demoQuiz, demo)), id: attempt.quizId };
  } else if (db && attempt.contentKey) {
    const record = await createD1LinkedTranscriptRepository(db).lookup({
      contentKey: attempt.contentKey,
      language: 'ja',
    });
    if (record) {
      const stored = await validateStoredTranscript(record);
      const candidate = validateQuizLesson({
        id: attempt.lessonId,
        segments: segmentTranscript(stored.cues),
      });
      if ((await transcriptKey(candidate)) === attempt.transcriptKey) {
        const artifact = await createD1GeneratedArtifactRepository(db).lookup({
          contentKey: attempt.contentKey,
          transcriptKey: attempt.transcriptKey,
          artifactType: 'quiz',
          schemaVersion: 1,
          generatorVersion: QUIZ_GENERATOR_VERSION,
        });
        if (artifact) {
          lesson = candidate;
          if (artifact.payloadId === attempt.quizId)
            quiz = await validateQuiz(
              { ...(artifact.payload as object), lessonId: attempt.lessonId },
              lesson,
            );
        }
      }
    }
  }
  if (!lesson || !quiz) return { ...attempt, verified: false }; // private/evicted quiz: internally consistent, explicitly self-reported.
  const scored = scoreQuiz(
    quiz,
    attempt.results.map((r) => r.selectedIndex),
  );
  const safe = validateAttempt(
    {
      schemaVersion: 1,
      id: attempt.id,
      lessonId: lesson.id,
      quizId: quiz.id,
      transcriptKey: quiz.transcriptKey,
      quizAttempted: true,
      startedAt: attempt.startedAt,
      updatedAt: attempt.updatedAt,
      completedAt: attempt.completedAt,
      ...scored,
    },
    quiz,
    lesson,
  );
  return {
    ...attempt,
    score: safe.score,
    totalQuestions: safe.totalQuestions,
    verified: true,
    results: safe.results.map(({ evidence, ...r }) => ({
      ...r,
      evidence: { segmentIds: evidence.segmentIds, start: evidence.start, end: evidence.end },
    })),
  };
}
