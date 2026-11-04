export type AnkiModel = { id: string; name: string; fields: string[] };
export type AnkiCard = { deck: string; interval: number | null };
export type AnkiNote = { id: string; model: string; fields: string[]; cards: AnkiCard[] };
export type AnkiPackage = {
  models: AnkiModel[];
  decks: string[];
  notes: AnkiNote[];
  media: boolean;
  format: string;
  scheduling: boolean;
};
export const roles = [
  'term',
  'reading',
  'translation',
  'sourceSentence',
  'sourceSentenceTranslation',
] as const;
export type Mapping = Record<(typeof roles)[number], number>;
export type ImportRecord = {
  term: string;
  reading: string;
  translation: string;
  sourceSentence: string;
  sourceSentenceTranslation: string;
  decks: string[];
  state: 'known' | 'learning';
};
export type ImportResult = {
  imported: number;
  duplicates: number;
  ambiguous: number;
  skipped: number;
  known: number;
  learning: number;
  preserved: number;
  rowsRead: number;
  rowsWritten: number;
  conflicts?: { term: string; incoming: string; existing: string }[];
};
