import type { LevelTarget } from './acquisition';
import type { LanguageEvidence } from './quality';
export const BANDS = [
  ['n5_plus', 'N5+', 'N5', 'N5'],
  ['n5_n4', 'N5–N4', 'N5', 'N4'],
  ['n4_n3', 'N4–N3', 'N4', 'N3'],
  ['n3_n2', 'N3–N2', 'N3', 'N2'],
  ['n2_n1', 'N2–N1', 'N2', 'N1'],
  ['n1_plus', 'N1+', 'N1', 'N1'],
] as const;
export type Band = (typeof BANDS)[number][0];
export const TOPICS = {
  everyday: 'Everyday life',
  vlogs: 'Vlogs',
  conversations: 'Conversations',
  food: 'Food',
  travel: 'Travel',
  entertainment: 'Entertainment',
  gaming: 'Gaming',
  news: 'News',
  education: 'Education',
} as const;
export type Topic = keyof typeof TOPICS;
export type Filters = {
  band: Band | 'for_you' | 'all';
  topic: Topic | 'all';
  q: string;
  duration: 'any' | 'under5' | '5to10' | '10to20' | 'over20';
  speed: 'any' | 'slow' | 'natural' | 'fast';
  captions: 'any' | 'reported' | 'prepared';
  audience: 'any' | 'learner' | 'native';
  sort: 'recommended' | 'newest' | 'shortest' | 'trending';
  diversity: 'balanced' | 'wide';
};
export const DEFAULT_FILTERS: Filters = {
  band: 'for_you',
  topic: 'all',
  q: '',
  duration: 'any',
  speed: 'any',
  captions: 'any',
  audience: 'any',
  sort: 'recommended',
  diversity: 'balanced',
};
export type Preferences = {
  preferredBand: Band | null;
  topics: Topic[];
  duration: Filters['duration'];
  diversity: Filters['diversity'];
};
export const DEFAULT_PREFERENCES: Preferences = {
  preferredBand: null,
  topics: [],
  duration: 'any',
  diversity: 'balanced',
};
export type Video = {
  videoId: string;
  canonicalUrl: string;
  title: string;
  channelId: string;
  channelTitle: string;
  thumbnailUrl: string | null;
  durationSeconds: number;
  description: string;
  publishedAt: string;
  fetchedAt: string;
  expiresAt: string;
  indexedAt: string;
  topics: Topic[];
  captionFlag: boolean;
  embeddable: boolean;
  status: 'available' | 'unavailable';
  regionAllowed: string[];
  regionBlocked: string[];
  audience: 'learner' | 'native' | null;
  prepared: boolean;
  preparationStatus?: 'unknown' | 'prepared' | 'needs-captions' | 'failed';
  band: Band | null;
  speed: number | null;
  proof: { transcriptKey: string; generatorVersion: string; verifiedAt: string } | null;
  popularity: number | null;
  /** Versioned metadata quality score; null until assessed. */
  qualityScore?: number | null;
  /** Strongest available evidence that the speech is Japanese. Never a difficulty claim. */
  languageEvidence?: LanguageEvidence | null;
  /** Search intent that found the video. Not a verified level. */
  levelTargets?: LevelTarget[];
};
export type Card = Video & { reason: string };
export type Context = {
  suggestedBand: Band | null;
  preferredTopics: Topic[];
  comfortableSeconds: number | null;
  completed: string[];
  saved: string[];
  seen: string[];
  ignored: string[];
  liked: string[];
  // Optional aggregate fit for locally prepared transcripts. No word lists leave the device.
  vocabularyFit: Record<string, number>;
};
export const EMPTY_CONTEXT: Context = {
  suggestedBand: null,
  preferredTopics: [],
  comfortableSeconds: null,
  completed: [],
  saved: [],
  seen: [],
  ignored: [],
  liked: [],
  vocabularyFit: {},
};
export type Feed = {
  items: Card[];
  lanes: { key: string; title: string; items: Card[] }[];
  nextCursor: string | null;
  hasMore: boolean;
  total: number;
  filters: Filters;
  suggestedBand: Band | null;
  catalogueUpdatedAt: string | null;
};
export const validVideoId = (id: unknown): id is string =>
  typeof id === 'string' && /^[a-zA-Z0-9_-]{11}$/.test(id);
export const canonicalUrl = (id: string) => `https://www.youtube.com/watch?v=${id}`;
export const bandFromRange = (min: string, max: string): Band | null =>
  BANDS.find((b) => b[2] === min && b[3] === max)?.[0] ?? null;
export interface Statement {
  bind(...values: (string | number | null)[]): Statement;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<unknown>;
}
export interface Database {
  prepare(sql: string): Statement;
  batch(statements: Statement[]): Promise<unknown[]>;
}
