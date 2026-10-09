export const wordStates = ['unknown', 'learning', 'known', 'ignored'] as const;
export type WordState = (typeof wordStates)[number];
export type WordKnowledgeRecord = {
  lemma: string;
  reading: string | null;
  state: WordState;
  updatedAt: string;
};
export type KnowledgeStates = Record<string, WordKnowledgeRecord>;
export type KnowledgePage = {
  records: WordKnowledgeRecord[];
  nextCursor: string | null;
  /** Server time at the start of this pull; pass it back as `since` for the next pull. */
  syncedThrough?: string;
};
export interface KnowledgeRepository {
  page(userId: string, cursor?: string | null, since?: string | null): Promise<KnowledgePage>;
  /** Applies last-writer-wins updates and returns the stored record for every uploaded lemma. */
  apply(userId: string, records: WordKnowledgeRecord[]): Promise<WordKnowledgeRecord[]>;
}
