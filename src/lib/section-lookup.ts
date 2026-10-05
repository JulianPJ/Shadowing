import type { MediaSource, Segment } from './types';

const DEFAULT_BOUNDARY_LEAD_SECONDS = 0.025;
const YOUTUBE_PAUSE_COMMAND_LEAD_MS = 55;
const YOUTUBE_MAX_EXTRA_PAUSE_LEAD_MS = 220;
const YOUTUBE_MAX_BOUNDARY_LEAD_SECONDS = 0.35;
const YOUTUBE_MAX_STALE_SAMPLE_MS = 350;
const YOUTUBE_SEEK_RESET_SECONDS = 0.5;

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
 * YouTube's iframe API can repeat the same cached currentTime across several fast polls. During
 * active playback, interpolate only across that short stale interval so boundary detection keeps
 * wall-clock pace. Fresh provider samples correct the estimate, while seeks reset it immediately.
 */
export function createBoundaryTimeEstimator(sourceType: MediaSource['type'], speed: number) {
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  let lastReported: number | null = null;
  let anchorEstimate = 0;
  let anchorAt = 0;

  return (reportedTime: number, nowMs: number) => {
    if (
      sourceType !== 'youtube' ||
      !Number.isFinite(reportedTime) ||
      !Number.isFinite(nowMs)
    )
      return reportedTime;

    if (lastReported === null) {
      lastReported = reportedTime;
      anchorEstimate = reportedTime;
      anchorAt = nowMs;
      return reportedTime;
    }

    const elapsedMs = Math.max(0, Math.min(nowMs - anchorAt, YOUTUBE_MAX_STALE_SAMPLE_MS));
    const projected = anchorEstimate + (elapsedMs / 1000) * safeSpeed;
    if (Math.abs(reportedTime - lastReported) < 0.001) return projected;

    const wentBackwards = reportedTime < lastReported - 0.05;
    const jumpedForward = reportedTime > projected + YOUTUBE_SEEK_RESET_SECONDS;
    lastReported = reportedTime;
    anchorAt = nowMs;
    if (wentBackwards || jumpedForward) {
      anchorEstimate = reportedTime;
      return reportedTime;
    }

    anchorEstimate = Math.max(reportedTime, projected);
    return anchorEstimate;
  };
}

/**
 * Learn the residual YouTube pause overshoot in wall-clock milliseconds. Positive boundary error
 * means playback stopped late and needs more lead next time; negative error reduces prior lead.
 */
export function adjustYoutubePauseCompensation(
  currentExtraMs: number,
  boundaryErrorSeconds: number,
  speed: number,
) {
  const safeCurrent =
    Number.isFinite(currentExtraMs) && currentExtraMs > 0
      ? Math.min(currentExtraMs, YOUTUBE_MAX_EXTRA_PAUSE_LEAD_MS)
      : 0;
  if (!Number.isFinite(boundaryErrorSeconds)) return safeCurrent;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const wallClockErrorMs = (boundaryErrorSeconds / safeSpeed) * 1000;
  return Math.max(
    0,
    Math.min(YOUTUBE_MAX_EXTRA_PAUSE_LEAD_MS, safeCurrent + wallClockErrorMs),
  );
}

/**
 * YouTube iframe pause commands cross a postMessage boundary, so send the command slightly early.
 * Scale the media-time lead by playback speed to keep the wall-clock allowance roughly constant.
 */
export function shadowingBoundaryLead(
  sourceType: MediaSource['type'],
  speed: number,
  extraPauseLeadMs = 0,
) {
  if (sourceType !== 'youtube') return DEFAULT_BOUNDARY_LEAD_SECONDS;
  const safeSpeed = Number.isFinite(speed) && speed > 0 ? speed : 1;
  const safeExtra =
    Number.isFinite(extraPauseLeadMs) && extraPauseLeadMs > 0
      ? Math.min(extraPauseLeadMs, YOUTUBE_MAX_EXTRA_PAUSE_LEAD_MS)
      : 0;
  return Math.max(
    0.03,
    Math.min(
      YOUTUBE_MAX_BOUNDARY_LEAD_SECONDS,
      ((YOUTUBE_PAUSE_COMMAND_LEAD_MS + safeExtra) / 1000) * safeSpeed,
    ),
  );
}
