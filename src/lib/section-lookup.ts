import type { Segment } from './types';

/** Preserve the playback predicate, including its 20 ms lead-in and gap behaviour. */
export function createSectionLookup(segments: Segment[], duration: number) {
  const linear = (time: number) =>
    segments.findIndex(
      (s, n) => time >= s.start - 0.02 && time < (segments[n + 1]?.start ?? duration + 1),
    );
  // Legacy browser lessons may be unsorted. Preserve their existing lookup semantics.
  if (segments.some((s, n) => n > 0 && s.start < segments[n - 1].start)) return linear;
  return (time: number) => {
    if (!Number.isFinite(time) || !segments.length) return -1;
    let low = 0;
    let high = segments.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (time < segments[middle + 1].start) high = middle;
      else low = middle + 1;
    }
    const section = segments[low];
    return time >= section.start - 0.02 && time < (segments[low + 1]?.start ?? duration + 1)
      ? low
      : -1;
  };
}
