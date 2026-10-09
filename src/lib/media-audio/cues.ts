import { validateCues } from '../segmentation';
import type { Cue } from '../types';

export function mapChunkCues(input: unknown, start: number, end: number): Cue[] {
  const cues = validateCues(input);
  return cues.map((cue) => {
    if (cue.start >= end - start || cue.end > end - start + 1)
      throw new Error(
        'AI subtitle generation returned timings outside its audio chunk. Add subtitles manually or try again.',
      );
    return { ...cue, start: cue.start + start, end: Math.min(end, cue.end + start) };
  });
}

export type TimedChunk = { start: number; end: number; cues: readonly Cue[] };
/** A cue ending this close to its chunk's cut was probably truncated by it. */
const CUT_EDGE_SECONDS = 0.3;
/** Allowance for the same moment being timed slightly differently by two chunks. */
const ALIGNMENT_SECONDS = 0.15;
/** Shortest shared text that proves two cues heard the same words at a seam. */
const MIN_SHARED_CHARACTERS = 2;

const IGNORED = new Set([...' \t\n\u3000、。，．,.!?！？…・「」『』（）()〜~"“”‘’\'']);
/** Text without spacing or punctuation, with each kept character's index in the original. */
function comparable(text: string) {
  let value = '';
  const index: number[] = [];
  for (let i = 0; i < text.length; i++)
    if (!IGNORED.has(text[i])) {
      value += text[i];
      index.push(i);
    }
  return { value, index };
}
function bigramSimilarity(a: string, b: string) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) {
    const gram = a.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  let shared = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const gram = b.slice(i, i + 2);
    const count = grams.get(gram) ?? 0;
    if (count) {
      shared++;
      grams.set(gram, count - 1);
    }
  }
  return (2 * shared) / (a.length + b.length - 2);
}
const overlapRatio = (a: Cue, b: Cue) => {
  const shared = Math.min(a.end, b.end) - Math.max(a.start, b.start);
  return shared <= 0 ? 0 : shared / (Math.max(a.end, b.end) - Math.min(a.start, b.start));
};

/**
 * How a later chunk's cue relates to an earlier chunk's cue at the same moment, judged by text:
 * the same words, one a fuller hearing of the other, or one continuing the other.
 */
function relate(earlier: Cue, later: Cue): Cue | 'same' | 'earlier' | 'later' | null {
  const a = comparable(earlier.text),
    b = comparable(later.text);
  if (!a.value || !b.value) return null;
  if (a.value === b.value) return 'same';
  if (a.value.includes(b.value)) return 'earlier';
  if (b.value.includes(a.value)) return 'later';
  // Two hearings of the same moment that differ by a misheard character or two.
  if (bigramSimilarity(a.value, b.value) >= 0.6 && overlapRatio(earlier, later) >= 0.5)
    return 'same';
  // The earlier cue was cut mid-sentence and the later one heard its end plus what followed.
  for (let k = Math.min(a.value.length, b.value.length) - 1; k >= MIN_SHARED_CHARACTERS; k--)
    if (a.value.endsWith(b.value.slice(0, k))) {
      const rest = later.text.slice(b.index[k - 1] + 1);
      return {
        start: earlier.start,
        end: Math.max(earlier.end, later.end),
        text: earlier.text + rest,
      };
    }
  return null;
}

/**
 * Joins overlapping chunk transcriptions. Within each four-second overlap, a cue heard by both
 * chunks is kept once: the fuller hearing wins, and a sentence cut by one chunk's edge is spliced
 * with the other chunk's continuation. Speech that only one chunk heard is always kept, so a
 * disagreement between chunks can repeat a few words but never loses them.
 */
export function mergeChunkCues(chunks: readonly TimedChunk[]): Cue[] {
  const merged: Cue[] = [];
  for (const [index, chunk] of chunks.entries()) {
    const previous = chunks[index - 1];
    if (!previous || chunk.start >= previous.end) {
      merged.push(...chunk.cues);
      continue;
    }
    const cut = previous.end;
    const tail = merged.flatMap((cue, position) =>
      cue.end > chunk.start - ALIGNMENT_SECONDS ? [position] : [],
    );
    const truncatedAtCut = (cue: Cue) => cue.end >= cut - CUT_EDGE_SECONDS;
    const truncatedAtStart = (cue: Cue) => cue.start < chunk.start + CUT_EDGE_SECONDS;
    for (const cue of chunk.cues) {
      if (cue.start >= cut) {
        merged.push(cue);
        continue;
      }
      let resolved = false;
      for (const position of tail) {
        const earlier = merged[position];
        if (
          cue.start >= earlier.end + ALIGNMENT_SECONDS ||
          earlier.start >= cue.end + ALIGNMENT_SECONDS
        )
          continue;
        const relation = relate(earlier, cue);
        if (!relation) continue;
        resolved = true;
        if (relation === 'later') merged[position] = cue;
        else if (relation === 'same') {
          // Prefer the hearing that neither chunk edge cut, then the longer one.
          const cutEarlier = truncatedAtCut(earlier),
            cutLater = truncatedAtStart(cue);
          if (
            cutEarlier !== cutLater
              ? cutEarlier
              : comparable(cue.text).value.length > comparable(earlier.text).value.length
          )
            merged[position] = cue;
        } else if (relation !== 'earlier') merged[position] = relation;
        break;
      }
      if (resolved) continue;
      // The remainder of an utterance the earlier chunk heard whole across this chunk's start.
      if (
        truncatedAtStart(cue) &&
        tail.some(
          (position) =>
            merged[position].start < chunk.start &&
            merged[position].end > chunk.start - ALIGNMENT_SECONDS,
        )
      )
        continue;
      merged.push(cue);
    }
  }
  return validateCues([...merged].sort((a, b) => a.start - b.start));
}
