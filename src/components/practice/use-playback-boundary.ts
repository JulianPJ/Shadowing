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
  resetTranslation: () => void;
  replayRange: QuizEvidence | null;
  media: RefObject<MediaHandle | null>;
  seeking: RefObject<{ target: number; deadline: number } | null>;
  setElapsed: Dispatch<SetStateAction<number>>;
  setStatus: Dispatch<SetStateAction<PlaybackState>>;
  setPracticeCount: Dispatch<SetStateAction<number>>;
  setIndex: Dispatch<SetStateAction<number>>;
};
export function usePlaybackBoundary({
  ready,
  isPlaying,
  mode,
  index,
  segment,
  lesson,
  duration,
  resetTranslation,
  replayRange,
  media,
  seeking,
  setElapsed,
  setStatus,
  setPracticeCount,
  setIndex,
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
      const time = adapter.time();
      if (seeking.current) {
        if (Math.abs(time - seeking.current.target) < 1.2 || Date.now() > seeking.current.deadline)
          seeking.current = null;
        else return;
      }
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
      // Detect user seeking with the native controls as well as advancing playback.
      const match = sectionAt(time);
      if (mode === 'shadowing') {
        // Check the armed section's boundary before considering the next section.
        if (time >= segment.end - 0.025 && time < segment.end + 1.25) {
          adapter.pause();
          setElapsed(segment.end);
          setStatus('your-turn');
          setPracticeCount((n) => n + 1);
          return;
        }
        if (match >= 0 && match !== index) {
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
    segment.end,
    lesson.segments,
    duration,
    resetTranslation,
    replayRange,
    sectionAt,
    media,
    seeking,
    setElapsed,
    setStatus,
    setPracticeCount,
    setIndex,
  ]);
}
