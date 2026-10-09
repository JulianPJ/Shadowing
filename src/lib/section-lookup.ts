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

/** How far before the previous section's end a provider may report a resumed playhead. */
export const RESUME_SLACK_SECONDS = 0.5;

/**
 * Continue arms the next section and resumes from where the previous one paused, without seeking.
 * Until the armed section's speech starts, the lookup still returns the previous row (including
 * its 20 ms lead-in into touching sections), and providers such as YouTube can report a resumed
 * time slightly before where they paused. Either way the learner is moving on: keep the armed
 * section rather than re-selecting the previous one and pausing at its end again.
 */
export function continuingIntoSection(
  segments: Segment[],
  index: number,
  match: number,
  time: number,
) {
  const previous = segments[index - 1];
  return (
    !!previous &&
    match === index - 1 &&
    time >= previous.end - RESUME_SLACK_SECONDS &&
    time < segments[index].start
  );
}
