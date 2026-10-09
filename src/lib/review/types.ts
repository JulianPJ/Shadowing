import type { ReviewEvent } from './history';
export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy';
export type ReviewState = {
  entryId: string;
  schemaVersion: 1;
  algorithm: 'sm2-v1';
  status: 'new' | 'learning' | 'review' | 'suspended';
  dueAt: string;
  lastReviewedAt: string | null;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
};
/** One review schedule per saved word. A suspended card is a word marked Known. */
export type ReviewSnapshot = {
  cards: ReviewState[];
  /** Accepted account ratings in the bounded authoritative window, when supplied by the server. */
  history?: ReviewEvent[];
  /** Replace local history from here; earlier returned events are accepted additions. */
  historySince?: string;
  /** Bounds returned events and removal of previously downloaded authoritative event IDs. */
  historyWindowStart?: string;
};
export type ReviewOperation =
  | { action: 'enroll'; entryIds: string[]; enrolledAt: string }
  | { action: 'suspend'; entryId: string; revision: number; operationId: string }
  | {
      action: 'undo';
      entryId: string;
      revision: number;
      operationId: string;
      targetOperationId: string;
      previous: ReviewState;
      undoneAt: string;
    }
  | {
      action: 'grade';
      entryId: string;
      revision: number;
      grade: ReviewGrade;
      reviewedAt: string;
      operationId: string;
    };
export const REVIEW_ACTIONS: readonly ReviewOperation['action'][] = [
  'enroll',
  'suspend',
  'undo',
  'grade',
];
export interface ReviewRepository {
  snapshot(userId: string): Promise<ReviewSnapshot>;
  apply(userId: string, operation: ReviewOperation): Promise<void>;
}
