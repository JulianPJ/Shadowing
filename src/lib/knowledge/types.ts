export const wordStates = ['unknown', 'learning', 'known', 'ignored'] as const;
export type WordState = (typeof wordStates)[number];
export type WordKnowledgeRecord = {
  lemma: string;
  reading: string | null;
  state: WordState;
  updatedAt: string;
};
export type KnowledgeStates = Record<string, WordKnowledgeRecord>;
export type KnowledgePage = { records: WordKnowledgeRecord[]; nextCursor: string | null };
export interface KnowledgeRepository {
  page(userId: string, cursor?: string | null): Promise<KnowledgePage>;
  apply(userId: string, records: WordKnowledgeRecord[]): Promise<void>;
}
