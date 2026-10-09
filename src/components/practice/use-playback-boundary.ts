'use client';
import { useEffect, useMemo } from 'react';
import { createSectionLookup } from '@/lib/section-lookup';
import type { Lesson, Mode, PlaybackState, QuizEvidence } from '@/lib/types';
import { type MediaHandle } from '../media-player';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { Segment } from '@/lib/types';

type BoundaryOptions = {
  ready: boolean;
  isPlaying: boolean;
  mode: Mode;
  index: number;
  segment: Segment;
  lesson: Lesson;
  duration: number;
  playbackOffsetMs: number;
  resetTranslation: () => void;
  replayRange: QuizEvidence | null;
  media: RefObject<MediaHandle | null>;
  seeking: RefObject<{ target: number; deadline: number } | null>;
  setElapsed: (time: number) => void;
  setStatus: Dispatch<SetStateAction<PlaybackState>>;
  setPracticeCount: Dispatch<SetStateAction<number>>;
  setIndex: Dispatch<SetStateAction<number>>;
  onSectionEnd?: () => void;
};

export function usePlaybackBoundary({
  ready,
  isPlaying,
  mode,
  index,
  segment,
  lesson,
  duration,
  playbackOffsetMs,
  resetTranslation,
  replayRange,
  media,
  seeking,
  setElapsed,
  setStatus,
  setPracticeCount,
  setIndex,
  onSectionEnd,
}: BoundaryOptions) {
  const sectionAt = useMemo(
    () => createSectionLookup(lesson.segments, duration),
    [lesson.segments, duration],
  );

  useEffect(() => {
    if (!ready || !isPlaying) return;
    let frame = 0;
    const tick = () => {
      const adapter = media.current;
      if (!adapter) return;
      const mediaTime = adapter.time();
      if (seeking.current) {
        if (
          Math.abs(mediaTime - seeking.current.target) < 1.2 ||
          Date.now() > seeking.current.deadline
        )
          seeking.current = null;
        else return;
      }
      // Convert provider time back onto the authored transcript timeline. A positive offset means
      // every authored section begins/ends later in the media; a negative value shifts it earlier.
      const time = mediaTime - playbackOffsetMs / 1000;
      if (replayRange) {
        if (time >= replayRange.end - 0.025) {
          adapter.pause();
          setElapsed(replayRange.end);
          setStatus('paused');
          return;
        }
        if (++frame % 5 === 0) setElapsed(time);
        return;
      }
      // This is the pre-refactor shadowing contract: arm the selected section's authored end
      // directly, then update the selected transcript row only after checking that boundary.
      const match = sectionAt(time);
      if (mode === 'shadowing') {
        if (time >= segment.end - 0.025 && time < segment.end + 1.25) {
          adapter.pause();
          setElapsed(segment.end);
          setStatus('your-turn');
          setPracticeCount((n) => n + 1);
          onSectionEnd?.();
          return;
        }
        // Continue arms the next section while playing the gap before its speech starts.
        // The lookup retains the preceding row through that gap; do not re-arm its old end.
        const continuingGap =
          match >= 0 &&
          match === index - 1 &&
          time >= lesson.segments[match].end - 0.025 &&
          time < segment.start - 0.02;
        if (match >= 0 && match !== index && !continuingGap) {
          setIndex(match);
          resetTranslation();
        }
      } else if (match >= 0 && match !== index) {
        setIndex(match);
        resetTranslation();
      }
      if (++frame % 5 === 0) setElapsed(time);
    };
    const interval = window.setInterval(tick, 35);
    // Avoid running past a section when a background tab throttles the timing loop.
    const visibility = () => {
      if (document.hidden && mode === 'shadowing') {
        media.current?.pause();
        setStatus('paused');
      } else tick();
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [
    ready,
    isPlaying,
    mode,
    index,
    segment.start,
    segment.end,
    lesson.segments,
    duration,
    playbackOffsetMs,
    resetTranslation,
    replayRange,
    sectionAt,
    media,
    seeking,
    setElapsed,
    setStatus,
    setPracticeCount,
    setIndex,
    onSectionEnd,
  ]);
}
