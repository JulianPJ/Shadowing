import type { DifficultyLevel, JlptLevel, Lesson, QuizAttempt } from './types';

export type LessonIdentity = {
  lessonId: string; transcriptKey: string; videoId?: string;
  title: string; author: string; source: Lesson['source']; duration: number; segmentCount: number;
};
export type SectionActivity = {
  sectionId: string; start: number; end: number;
  replays: number; evidenceReplays: number; translationReveals: number;
  translationHelp: boolean; recordingAttempts: number;
};
// No transcript, translation, quiz content or audio belongs in these records.
export type PracticeSession = {
  schemaVersion: 1; id: string; lesson: LessonIdentity;
  origin: 'practice' | 'legacy'; startedAt: string | null; updatedAt: string;
  endedAt: string | null; completed: boolean; completedAt: string | null;
  activeSeconds: number; activeByDay: Record<string, number>;
  lastSectionId: string | null; sections: SectionActivity[];
};
export type PracticeArchive = { schemaVersion: 1; lesson: LessonIdentity; sessionCount: number; activity: PracticeSession };
export type DifficultyReference = {
  schemaVersion: 1; id: string; lessonId: string; transcriptKey: string; generatedAt: string;
  jlptMin: JlptLevel; jlptMax: JlptLevel; vocabulary: DifficultyLevel; grammar: DifficultyLevel;
  speechSpeed: DifficultyLevel | null; conversationalComplexity: DifficultyLevel;
};
export type LearnerHistory = {
  schemaVersion: 1; migrationVersion: 1; sessions: PracticeSession[]; archives: PracticeArchive[];
  difficulties: DifficultyReference[];
};
export type BookmarkSnapshot = { lesson: LessonIdentity; sections: { sectionId: string; start: number; end: number }[] };
export type AttentionSection = SectionActivity & {
  lesson: LessonIdentity; bookmarked: boolean; missedQuestions: number; reasons: string[]; rank: number;
};
export type LessonProgress = {
  lesson: LessonIdentity; lastPractisedAt: string; completed: boolean; practised: boolean;
  activeSeconds: number; sessions: number; lastSectionId: string | null;
  difficulty: DifficultyReference | null; quizAttempts: number; quizCompleted: number;
};
export type LearnerProfile = {
  schemaVersion: 1; distinctLessons: number; completedLessons: number; sessionCount: number;
  activeSeconds: number; recentActiveSeconds: number; replays: number; evidenceReplays: number;
  translationReveals: number; translationSections: number; recordingAttempts: number; bookmarks: number;
  comprehension: { attempts: number; completed: number; correct: number; total: number; recentCorrect: number; recentTotal: number; missedQuestions: number; history: QuizAttempt[] };
  typicalContent: { min: JlptLevel; max: JlptLevel; lessons: number } | null;
  contentTrend: 'harder' | 'similar' | 'easier' | null;
  lessons: LessonProgress[]; attention: AttentionSection[];
};
