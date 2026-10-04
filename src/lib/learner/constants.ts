import type { ContentDifficultyAnalysis, Lesson } from '../types';
import type { DifficultyReference, LearnerHistory, LessonIdentity } from '../learner-types';
export const RESUME_WINDOW_MS = 30 * 60 * 1000;

export const CHECKPOINT_MS = 15000;

export const INTERACTION_WINDOW_MS = 30000;

export const DETAIL_SESSION_LIMIT = 500;

export const ARCHIVE_LIMIT = 2000;

export const HISTORY_BYTE_LIMIT = 2_000_000;

export const ATTENTION_WEIGHTS = {
  replay: 1,
  translation: 2,
  bookmark: 2,
  missedQuestion: 3,
  repeatedRecording: 1,
};

export const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'] as const;

export const identityKey = (lesson: Pick<LessonIdentity, 'lessonId' | 'transcriptKey'>) =>
  JSON.stringify([lesson.lessonId, lesson.transcriptKey]);

export const emptyHistory = (): LearnerHistory => ({
  schemaVersion: 1,
  migrationVersion: 1,
  sessions: [],
  archives: [],
  difficulties: [],
});

export function lessonIdentity(lesson: Lesson, transcriptKey: string): LessonIdentity {
  return {
    lessonId: lesson.id,
    transcriptKey,
    ...(lesson.videoId ? { videoId: lesson.videoId } : {}),
    title: lesson.title.slice(0, 500),
    author: lesson.author.slice(0, 300),
    source: lesson.source,
    duration: lesson.segments.at(-1)?.end ?? 0,
    segmentCount: lesson.segments.length,
  };
}

export function compactDifficulty(a: ContentDifficultyAnalysis): DifficultyReference {
  return {
    schemaVersion: 1,
    id: a.id,
    lessonId: a.lessonId,
    transcriptKey: a.transcriptKey,
    generatedAt: a.generatedAt,
    jlptMin: a.overall.jlptMin,
    jlptMax: a.overall.jlptMax,
    vocabulary: a.vocabulary.level,
    grammar: a.grammar.level,
    speechSpeed: a.speechSpeed.level,
    conversationalComplexity: a.conversationalComplexity.level,
  };
}
