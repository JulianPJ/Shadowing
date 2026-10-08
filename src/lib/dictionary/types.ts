export type DictionaryMediaType = 'youtube' | 'vimeo' | 'direct' | 'local' | 'demo';

export type DictionarySource = {
  lessonId: string;
  segmentId: string;
  lessonTitle: string;
  lessonAuthor: string;
  mediaType: DictionaryMediaType;
  mediaId: string | null;
  mediaUrl: string | null;
  mediaContentKey: string | null;
  transcriptKey: string;
  start: number;
  end: number;
};

export type DictionarySaveInput = {
  schemaVersion: 1;
  term: string;
  reading: string | null;
  translation: string;
  sourceSentence: string;
  sourceSentenceTranslation: string;
  source: DictionarySource;
};

export type DictionaryEntry = DictionarySaveInput & {
  id: string;
  normalizedTerm: string;
  createdAt: string;
  updatedAt: string;
  tags?: import('../tags/types').Tag[];
};

export type DictionaryQuery = {
  limit?: number;
  cursor?: string | null;
  term?: string;
  /** Bounded partial search across Japanese term, reading and chosen meaning. */
  search?: string;
  deckId?: string;
  tagId?: string;
  lessonId?: string;
  transcriptKey?: string;
};
export type DictionaryPage = { entries: DictionaryEntry[]; nextCursor: string | null };

export interface DictionaryRepository {
  list(userId: string): Promise<DictionaryEntry[]>;
  page(userId: string, query: DictionaryQuery): Promise<DictionaryPage>;
  byIds(userId: string, ids: string[]): Promise<DictionaryEntry[]>;
  save(userId: string, input: DictionarySaveInput): Promise<DictionaryEntry>;
  remove(userId: string, id: string): Promise<void>;
}
