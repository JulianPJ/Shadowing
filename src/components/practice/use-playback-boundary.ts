'use client';
import { useEffect, useMemo } from 'react';
import {
  createBoundaryTimeEstimator,
  createSectionLookup,
  sectionPlaybackEnd,
  shadowingBoundaryLead,
} from '@/lib/section-lookup';
import { lessonMedia } from '@/lib/media';
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
  speed: number;
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
  speed,
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
  const playbackEnd = sectionPlaybackEnd(lesson.segments, index);
  const sourceType = lessonMedia(lesson).type;
  const boundaryLead = shadowingBoundaryLead(sourceType, speed);

  useEffect(() => {
    if (!ready || !isPlaying) return;
    let frame = 0;
    const estimateTime = createBoundaryTimeEstimator(sourceType, speed);
    const tick = () => {
      const adapter = media.current;
      if (!adapter) return;
      const reportedTime = adapter.time();
      if (seeking.current) {
        if (
          Math.abs(reportedTime - seeking.current.target) < 1.2 ||
          Date.now() > seeking.current.deadline
        )
          seeking.current = null;
        else return;
      }
      const time = estimateTime(reportedTime, performance.now());
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
        // YouTube pause commands are asynchronous. The boundary estimator keeps cached iframe
        // timestamps moving between provider samples, then this small lead absorbs command latency.
        if (time >= playbackEnd - boundaryLead && time < playbackEnd + 1.25) {
          adapter.pause();
          setElapsed(playbackEnd);
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
    // 20 ms keeps the pause command comfortably ahead of a YouTube iframe boundary without
    // running a full animation-frame loop for the duration of the lesson.
    const interval = window.setInterval(tick, 20);
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
    lesson,
    lesson.segments,
    duration,
    speed,
    playbackEnd,
    sourceType,
    boundaryLead,
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
