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

/** Remove matching utterances only at matching times; repetitions at distinct times survive. */
export function mergeChunkCues(chunks: readonly Cue[][]): Cue[] {
  const merged: Cue[] = [];
  for (const cues of chunks) {
    const preceding = merged.slice(-30);
    for (const cue of cues) {
      const duplicate = preceding.find((previous) => {
        if (
          previous.text !== cue.text ||
          Math.abs(previous.start - cue.start) > 0.35 ||
          Math.abs(previous.end - cue.end) > 0.35
        )
          return false;
        const overlap = Math.min(previous.end, cue.end) - Math.max(previous.start, cue.start);
        return (
          overlap > 0 &&
          overlap / Math.max(previous.end - previous.start, cue.end - cue.start) >= 0.8
        );
      });
      if (!duplicate) merged.push(cue);
    }
  }
  return validateCues(merged);
}
