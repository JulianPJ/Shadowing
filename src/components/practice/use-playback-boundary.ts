'use client';
import { useEffect, useMemo, useRef } from 'react';
import {
  adjustYoutubePauseCompensation,
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
  const youtubePauseCompensationMs = useRef(0);
  const settleTimer = useRef<number | null>(null);
  const boundaryRun = useRef(0);

  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!ready || !isPlaying) return;
    const run = ++boundaryRun.current;
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
        // YouTube pause commands are asynchronous. Keep cached iframe timestamps moving and learn
        // any residual overshoot so later sections arm earlier on this exact player/session.
        const boundaryLead = shadowingBoundaryLead(
          sourceType,
          speed,
          youtubePauseCompensationMs.current,
        );
        if (time >= playbackEnd - boundaryLead && time < playbackEnd + 1.25) {
          const boundary = playbackEnd;
          const pauseRequestedAt = performance.now();
          adapter.pause();
          if (sourceType === 'youtube') {
            if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
            const settle = () => {
              if (boundaryRun.current !== run) return;
              const current = media.current;
              if (!current) return;
              const waitedMs = performance.now() - pauseRequestedAt;
              if (current.isPlaying() && waitedMs < 600) {
                settleTimer.current = window.setTimeout(settle, 20);
                return;
              }
              settleTimer.current = null;
              if (current.isPlaying()) return;
              const pausedTime = current.time();
              if (!Number.isFinite(pausedTime)) return;
              youtubePauseCompensationMs.current = adjustYoutubePauseCompensation(
                youtubePauseCompensationMs.current,
                pausedTime - boundary,
                speed,
              );
              // Most prepared lessons are contiguous. Park any late YouTube pause on the exact
              // section edge so Continue never has to visibly rewind into the next sentence.
              if (pausedTime > boundary + 0.02) {
                current.seek(boundary);
                seeking.current = { target: boundary, deadline: Date.now() + 1500 };
              }
            };
            settleTimer.current = window.setTimeout(settle, 20);
          }
          setElapsed(boundary);
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
