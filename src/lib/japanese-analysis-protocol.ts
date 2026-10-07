import type { MorphologicalToken } from './japanese-readings';

// Bound transport and uninterrupted worker time without changing sentence context.
// A single longer sentence is analyzed intact and occupies a batch by itself.
export const JAPANESE_BATCH_MAX_ITEMS = 8;
export const JAPANESE_BATCH_MAX_CHARACTERS = 4096;

export type JapaneseWorkerItem = { id: number; text: string };
export type JapaneseWorkerResult = {
  id: number;
  tokens?: readonly MorphologicalToken[];
  error?: boolean;
};
export type JapaneseWorkerRequest =
  | { id: number; text: string; kind?: 'readings' | 'morphology' }
  | { id: number; kind: 'morphology-batch'; items: readonly JapaneseWorkerItem[] };
export type JapaneseWorkerResponse = {
  id: number;
  kind?: 'readings' | 'morphology' | 'morphology-batch';
  tokens?: unknown;
  results?: readonly JapaneseWorkerResult[];
  error?: boolean;
};
