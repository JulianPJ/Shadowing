import type {
  DifficultyReference,
  LessonIdentity,
  PracticeArchive,
  PracticeSession,
} from '../learner-types';
import type { Mode, QuizAnswerResult } from '../types';

export type SyncedPreferences = {
  schemaVersion: 1;
  mode: Mode;
  speed: number;
  studioMode: boolean;
  furigana: boolean;
  updatedAt: string;
};
export type SyncedLesson = {
  id: string;
  lesson: LessonIdentity;
  contentKey: string | null;
  providerMediaId: string | null;
  mediaAvailable: boolean;
  lastSectionId: string | null;
  position: number;
  updatedAt: string;
  completed: boolean;
  completedAt: string | null;
};
export type SyncedBookmark = {
  id: string;
  lesson: LessonIdentity;
  sectionId: string;
  start: number;
  end: number;
  updatedAt: string;
  deleted: boolean;
};
export type SyncedAttempt = {
  schemaVersion: 1;
  id: string;
  lessonId: string;
  videoId?: string;
  quizId: string;
  transcriptKey: string;
  contentKey: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  totalQuestions: number;
  score: number;
  verified: boolean;
  results: (Omit<QuizAnswerResult, 'evidence'> & {
    evidence: { segmentIds: string[]; start: number; end: number };
  })[];
};
export type SyncedArchive = { id: string; archive: PracticeArchive; updatedAt: string };
export type SyncData = {
  preferences: SyncedPreferences | null;
  lessons: SyncedLesson[];
  sessions: PracticeSession[];
  attempts: SyncedAttempt[];
  bookmarks: SyncedBookmark[];
  difficulties: DifficultyReference[];
  archives: SyncedArchive[];
};
export const syncCollections = [
  'lessons',
  'sessions',
  'attempts',
  'bookmarks',
  'difficulties',
  'archives',
] as const;
export type SyncCollection = (typeof syncCollections)[number];
export const emptySync = (): SyncData => ({
  preferences: null,
  lessons: [],
  sessions: [],
  attempts: [],
  bookmarks: [],
  difficulties: [],
  archives: [],
});
export type SyncPage = { data: SyncData; nextCursor: string | null };
export interface UserProgressRepository {
  lesson(userId: string, id: string): Promise<SyncedLesson | null>;
  bootstrap(userId: string, cursor?: string | null): Promise<SyncPage>;
  push(userId: string, data: SyncData): Promise<void>;
}
export type AccountUser = { id: string; email: string; name: string; emailVerified: boolean };
