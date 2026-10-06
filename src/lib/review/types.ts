import type { Deck, DeckMembership } from '../decks/types';
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
export type ReviewSnapshot = { decks: Deck[]; memberships: DeckMembership[]; cards: ReviewState[] };
export type ReviewOperation =
  | { action: 'deck'; id: string; name: string }
  | { action: 'delete-deck'; deckId: string }
  | { action: 'membership'; deckId: string; entryIds: string[]; remove: boolean }
  | { action: 'enroll'; entryIds: string[]; deckId: string; enrolledAt: string }
  | { action: 'suspend'; entryId: string; revision: number; operationId: string }
  | {
      action: 'grade';
      entryId: string;
      revision: number;
      grade: ReviewGrade;
      reviewedAt: string;
      operationId: string;
    };
export interface ReviewRepository {
  snapshot(userId: string): Promise<ReviewSnapshot>;
  apply(userId: string, operation: ReviewOperation): Promise<void>;
}
