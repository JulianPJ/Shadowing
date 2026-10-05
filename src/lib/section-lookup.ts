import type { MediaSource, Segment } from './types';

const DEFAULT_BOUNDARY_LEAD_SECONDS = 0.025;
const YOUTUBE_PAUSE_COMMAND_LEAD_MS = 55;

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

/**
 * The next section's start is the hard playback boundary when legacy/provider timings overlap.
 * This prevents shadowing playback from entering speech that belongs to the following section.
 */
export function sectionPlaybackEnd(segments: Segment[], index: number) {
  const section = segments[index];
  if (!section) return 0;
  const nextStart = segments[index + 1]?.start;
  return typeof nextStart === 'number' && Number.isFinite(nextStart) && nextStart > section.start
    ? Math.min(section.end, nextStart)
    : section.end;
}

/**
 * YouTube iframe pause commands cross a postMessage boundary, so send the command slightly early.
 * Scale the media-time lead by playback speed to keep the wall-clock allowance roughly constant.
 */
export function shadowingBoundaryLead(sourceType: MediaSource['type'], speed: number) {
  if (sourceType !== 'youtube') return DEFAULT_BOUNDARY_LEAD_SECONDS;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  return Math.max(
    0.03,
    Math.min(0.08, (YOUTUBE_PAUSE_COMMAND_LEAD_MS / 1000) * safeSpeed),
  );
}
