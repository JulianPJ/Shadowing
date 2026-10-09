'use client';
import { CurrentSection } from './current-section';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Languages, Keyboard, Upload, PanelTop } from 'lucide-react';
import type { Lesson, Mode, PlaybackState, QuizEvidence } from '@/lib/types';
import {
  writeStorage,
  saveLesson,
  completeLesson,
  lessonCompleted,
  loadFavorites,
  loadPreferences,
  PLAYBACK_OFFSET_MIN_MS,
  PLAYBACK_OFFSET_MAX_MS,
  PLAYBACK_OFFSET_STEP_MS,
  type Preferences,
} from '@/lib/storage';
import { lessonMedia, sourceLabel, MEDIA_ACCEPT, validateMediaFile } from '@/lib/media';
import { localMediaFile, localMediaUrl } from '@/lib/local-media-file';
import { timestamp } from '@/lib/youtube';
import { MediaPlayer, type MediaHandle } from '../media-player';
import { VoiceRecorder, type VoiceRecorderHandle } from '../voice-recorder';
import { loadDrillSettings, practicePreset, type PracticePreset } from '@/lib/drill-presets';
import { LessonCompletionSummary } from '../lesson-completion-summary';
import { LessonVocabulary } from '../lesson-vocabulary';
import { useProAccess } from '../pro-feature';
import { transcriptRevision } from '@/lib/transcript';
import { storageAccount } from '@/lib/storage/browser';
import {
  rememberPracticeReturn,
  loadPracticeReturn,
  clearPracticeReturn,
} from '@/lib/practice-return';
import {
  aggregateShadowingScores,
  loadShadowingSession,
  saveShadowingSession,
  shadowingSummarySignals,
  upsertShadowingSection,
} from '@/lib/shadowing-session';
import {
  deterministicShadowingAnalysis,
  shadowingAttemptFeedback,
  shadowingSessionSummary,
  transcribeShadowingRecording,
  validateShadowingRecordingBeforeUpload,
} from '@/lib/shadowing-client';

import { usePracticeProgress } from '../use-practice-progress';
import { useSectionTranslation } from './use-section-translation';
import { usePlaybackBoundary } from './use-playback-boundary';
import { TranscriptPanel } from './transcript-panel';
export type Session = { lesson: Lesson; index: number; preferences: Preferences };
export function StudyPlayer({ session, onHelp }: { session: Session; onHelp: () => void }) {
  const { isPro } = useProAccess();
  const shadowingRevision = transcriptRevision(session.lesson);
  const [lesson, setLesson] = useState(session.lesson);
  const [returnPosition] = useState(() => loadPracticeReturn(session.lesson));
  const openingIndex = returnPosition?.index ?? session.index;
  const [index, setIndex] = useState(openingIndex);
  const [mode, setMode] = useState<Mode>(session.preferences.mode);
  const [drill, setDrill] = useState(() => loadDrillSettings(session.preferences.mode));
  const [drillRunning, setDrillRunning] = useState(false);
  const [drillPreparing, setDrillPreparing] = useState(false);
  const recorder = useRef<VoiceRecorderHandle>(null);
  const repeatNumber = useRef(1);
  const boundaryGeneration = useRef(0);
  const handledBoundary = useRef(-1);
  const automationId = useRef(0);
  const responseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopAutomation = useCallback(() => {
    automationId.current++;
    if (responseTimer.current) clearTimeout(responseTimer.current);
    responseTimer.current = null;
    recorder.current?.cancel();
    setDrillRunning(false);
    setDrillPreparing(false);
    repeatNumber.current = 1;
  }, []);
  const [speed, setSpeed] = useState(session.preferences.speed);
  const [playbackOffsetMs, setPlaybackOffsetMs] = useState(session.preferences.playbackOffsetMs);
  const [studioMode, setStudioMode] = useState(session.preferences.studioMode);
  const [furigana, setFurigana] = useState(session.preferences.furigana);
  const [status, setStatus] = useState<PlaybackState>(returnPosition ? 'paused' : 'ready');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [elapsed, setElapsed] = useState(
    returnPosition
      ? Math.max(0, returnPosition.mediaTime - session.preferences.playbackOffsetMs / 1000)
      : lesson.segments[openingIndex].start,
  );
  const [shadowingScores, setShadowingScores] = useState(() =>
    loadShadowingSession(session.lesson.id, shadowingRevision),
  );
  const [scoringSection, setScoringSection] = useState<string | null>(null);
  const [scoringError, setScoringError] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const scoreAbort = useRef<AbortController | null>(null);
  const summaryAbort = useRef<AbortController | null>(null);

  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(lesson));
  const [recommendedSegmentIds, setRecommendedSegmentIds] = useState<Set<string> | null>(null);
  const filterRecommendations = useCallback((ids: string[] | null) => {
    setRecommendedSegmentIds((current) => {
      if (ids === null) return null;
      if (current?.size === ids.length && ids.every((id) => current.has(id))) return current;
      return new Set(ids);
    });
  }, []);

  const [finished, setFinished] = useState(false);
  const [completed, setCompleted] = useState(() => lessonCompleted(session.lesson));
  const [quizOpen, setQuizOpen] = useState(false);
  const [secondaryTool, setSecondaryTool] = useState<'transcript' | 'vocabulary' | 'review'>(
    'transcript',
  );
  const [evidenceQuestion, setEvidenceQuestion] = useState('');
  const [difficultyWaiting, setDifficultyWaiting] = useState(false);
  const [replayRange, setReplayRange] = useState<QuizEvidence | null>(null);
  const replayResumeIndex = useRef<number | null>(null);
  const practiceArea = useRef<HTMLDivElement>(null);
  const [practiceCount, setPracticeCount] = useState(0);
  const media = useRef<MediaHandle>(null);

  const seeking = useRef<{ target: number; deadline: number } | null>(null);

  const segment = lesson.segments[index];
  const isPlaying = status === 'listening';
  const playbackOffsetSeconds = playbackOffsetMs / 1000;
  const mediaTimeFor = useCallback(
    (transcriptTime: number) => Math.max(0, transcriptTime + playbackOffsetSeconds),
    [playbackOffsetSeconds],
  );
  const shadowingAggregate = useMemo(
    () => aggregateShadowingScores(shadowingScores, lesson.segments.length),
    [shadowingScores, lesson.segments.length],
  );
  const shadowingSignals = useMemo(
    () => shadowingSummarySignals(shadowingScores, lesson.segments.length),
    [shadowingScores, lesson.segments.length],
  );
  const currentShadowingResult = shadowingScores.sections[segment.id];
  const currentShadowingSummary =
    shadowingSignals && shadowingScores.summary?.fingerprint === shadowingSignals.fingerprint
      ? shadowingScores.summary
      : undefined;
  const readPlaybackTime = useCallback(
    () => Math.max(0, (media.current?.time() ?? 0) - playbackOffsetSeconds),
    [playbackOffsetSeconds],
  );
  const progress = usePracticeProgress(
    lesson,
    {
      playing: ready && isPlaying && !playbackError,
      recording,
      excluded: quizOpen || difficultyWaiting,
      yourTurn: status === 'your-turn' && !recording,
      segment,
      speed,
    },
    readPlaybackTime,
  );
  const recordSignal = progress.signal;
  const {
    revealed,
    translation,
    translating,
    translationError,
    translationProvider,
    resetTranslation,
    revealTranslation,
    setTranslationError,
  } = useSectionTranslation(lesson, index, openingIndex, recordSignal);
  const recordCompletion = progress.complete;
  const isFavorite = favorites.includes(segment.id);

  const duration = lesson.segments.at(-1)!.end;
  const percent = Math.min(
    100,
    Math.max(0, ((elapsed - segment.start) / (segment.end - segment.start)) * 100),
  );
  const presetDefaults = practicePreset(drill.preset);
  const customized = (['repeats', 'pause', 'reveal', 'responseSeconds'] as const).some(
    (key) => drill[key] !== presetDefaults[key],
  );
  const stateLabel = recording
    ? 'RECORDING'
    : {
        ready: 'READY WHEN YOU ARE',
        listening: 'LISTEN CLOSELY',
        paused: 'TAKE A BREATH',
        'your-turn': 'YOUR TURN',
        complete: 'SESSION FINISHED',
      }[status];
  useEffect(() => {
    const hydrate = () => {
      const prefs = loadPreferences();
      setMode(prefs.mode);
      setDrill(loadDrillSettings(prefs.mode));
      setSpeed(prefs.speed);
      setPlaybackOffsetMs(prefs.playbackOffsetMs);
      setStudioMode(prefs.studioMode);
      setFurigana(prefs.furigana);
      setFavorites(loadFavorites(lesson));
      setCompleted(lessonCompleted(lesson));
    };
    const changeAccount = () => {
      stopAutomation();
      scoreAbort.current?.abort();
      scoreAbort.current = null;
      summaryAbort.current?.abort();
      summaryAbort.current = null;
      setScoringSection(null);
      setScoringError('');
      setSummaryLoading(false);
      setShadowingScores(loadShadowingSession(lesson.id, shadowingRevision));
      setRecommendedSegmentIds(null);
      hydrate();
    };
    window.addEventListener('hibiki:sync-hydrated', hydrate);
    window.addEventListener('hibiki:account-change', changeAccount);
    return () => {
      window.removeEventListener('hibiki:sync-hydrated', hydrate);
      window.removeEventListener('hibiki:account-change', changeAccount);
    };
  }, [lesson, shadowingRevision, stopAutomation]);
  useEffect(() => {
    if (returnPosition) clearPracticeReturn();
  }, [returnPosition]);
  useEffect(() => {
    saveLesson(lesson, index);
  }, [lesson, index]);
  useEffect(() => {
    writeStorage('preferences', {
      ...loadPreferences(),
      mode,
      speed,
      playbackOffsetMs,
      translation: false,
      studioMode,
      furigana,
    });
  }, [mode, speed, playbackOffsetMs, studioMode, furigana]);
  useEffect(() => {
    writeStorage('drill:settings', drill);
  }, [drill]);
  useEffect(() => {
    const generation = automationId;
    const interrupt = () => {
      if (document.hidden) stopAutomation();
    };
    window.addEventListener('hibiki:account-changing', stopAutomation);
    document.addEventListener('visibilitychange', interrupt);
    return () => {
      generation.current++;
      if (responseTimer.current) clearTimeout(responseTimer.current);
      window.removeEventListener('hibiki:account-changing', stopAutomation);
      document.removeEventListener('visibilitychange', interrupt);
    };
  }, [stopAutomation]);
  useEffect(() => {
    document.body.classList.toggle('studio-active', studioMode);
    return () => document.body.classList.remove('studio-active');
  }, [studioMode]);
  useEffect(() => {
    media.current?.setSpeed(speed);
  }, [speed]);
  useEffect(() => {
    const captureReturn = () => {
      if (!replayRange && ready)
        rememberPracticeReturn(
          lesson,
          index,
          media.current?.time() ?? elapsed + playbackOffsetMs / 1000,
        );
    };
    const leave = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[href]');
      if (
        !link ||
        link.target === '_blank' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const destination = new URL(link.href, window.location.href);
      if (
        destination.origin === window.location.origin &&
        destination.pathname !== window.location.pathname
      )
        captureReturn();
    };
    document.addEventListener('click', leave, true);
    window.addEventListener('pagehide', captureReturn);
    return () => {
      document.removeEventListener('click', leave, true);
      window.removeEventListener('pagehide', captureReturn);
    };
  }, [lesson, index, elapsed, playbackOffsetMs, replayRange, ready]);

  useEffect(() => {
    writeStorage(`favorites:${lesson.id}`, favorites);
  }, [lesson.id, favorites]);
  useEffect(
    () => () => {
      scoreAbort.current?.abort();
      summaryAbort.current?.abort();
    },
    [],
  );

  function summarizeShadowing() {
    if (!isPro || !finished || !shadowingSignals) return;
    if (shadowingScores.summary?.fingerprint === shadowingSignals.fingerprint) return;
    if (summaryAbort.current) return;
    const controller = new AbortController();
    const owner = storageAccount();
    summaryAbort.current = controller;
    setSummaryLoading(true);
    void shadowingSessionSummary(shadowingSignals, controller.signal)
      .then((summary) => {
        if (controller.signal.aborted || storageAccount() !== owner) return;
        setShadowingScores((current) => {
          if (controller.signal.aborted || storageAccount() !== owner) return current;
          const next = {
            ...current,
            summary: { ...summary, fingerprint: shadowingSignals.fingerprint },
          };
          saveShadowingSession(next);
          return next;
        });
      })
      .finally(() => {
        if (summaryAbort.current === controller) summaryAbort.current = null;
        if (!controller.signal.aborted) setSummaryLoading(false);
      });
  }

  const navigate = useCallback(
    (
      nextIndex: number,
      play = true,
      evidenceReplay = false,
      preserveAutomation = false,
      resume = false,
    ) => {
      if (!preserveAutomation) stopAutomation();
      boundaryGeneration.current++;
      scoreAbort.current?.abort();
      scoreAbort.current = null;
      setScoringSection(null);
      setScoringError('');
      summaryAbort.current?.abort();
      summaryAbort.current = null;
      setSummaryLoading(false);
      if (!evidenceReplay) {
        setReplayRange(null);
        replayResumeIndex.current = null;
      }
      const next = Math.min(Math.max(nextIndex, 0), lesson.segments.length - 1);
      const target = lesson.segments[next];
      if (!evidenceReplay) recordSignal(target, 'navigate');
      const mediaTarget = mediaTimeFor(target.start);
      // Continuing after a response resumes the media clock, including uncaptioned footage.
      // Explicit navigation and replay still seek to the authored speech start.
      if (!resume) {
        media.current?.pause();
        media.current?.seek(mediaTarget);
        seeking.current = { target: mediaTarget, deadline: Date.now() + 4000 };
      }
      setIndex(next);
      setElapsed(resume ? readPlaybackTime() : target.start);
      setStatus(play ? 'listening' : 'ready');
      if (!evidenceReplay) setFinished(false);
      setPlaybackError('');
      if (next !== index) resetTranslation();
      if (play)
        void media.current?.play().catch(() => {
          setStatus('paused');
          setPlaybackError('Playback didn’t start. Press play inside the video, then try again.');
        });
    },
    [
      lesson.segments,
      index,
      resetTranslation,
      recordSignal,
      mediaTimeFor,
      stopAutomation,
      readPlaybackTime,
    ],
  );
  const replaySection = useCallback(() => {
    recordSignal(segment, 'replay');
    navigate(index);
  }, [recordSignal, segment, navigate, index]);
  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      stopAutomation();
      media.current?.pause();
      setStatus('paused');
      return;
    }
    if (
      mode === 'shadowing' &&
      (status === 'your-turn' ||
        status === 'complete' ||
        status === 'ready' ||
        media.current!.time() - playbackOffsetSeconds >= segment.end - 0.08)
    ) {
      navigate(index);
      return;
    }
    if (mode === 'continuous' && status === 'complete') {
      navigate(0);
      return;
    }
    setPlaybackError('');
    setStatus('listening');
    void media.current?.play().catch(() => {
      setStatus('paused');
      setPlaybackError('Playback didn’t start. Try the play button inside the video.');
    });
  }, [
    isPlaying,
    mode,
    status,
    segment.end,
    navigate,
    index,
    playbackOffsetSeconds,
    stopAutomation,
  ]);
  const continuePractice = useCallback(() => {
    stopAutomation();
    if (index === lesson.segments.length - 1) {
      media.current?.pause();
      setStatus('complete');
      setFinished(true);
      setSecondaryTool('review');
      setCompleted(true);
      completeLesson(lesson);
      recordCompletion();
      setPracticeCount((n) => n + 1);
      return;
    }
    setPracticeCount((n) => n + 1);
    navigate(index + 1, true, false, false, true);
  }, [index, lesson, navigate, recordCompletion, stopAutomation]);

  const automaticContinue = useCallback(() => {
    repeatNumber.current = 1;
    if (index === lesson.segments.length - 1) {
      stopAutomation();
      media.current?.pause();
      setStatus('complete');
      setFinished(true);
      setSecondaryTool('review');
      setCompleted(true);
      completeLesson(lesson);
      recordCompletion();
    } else navigate(index + 1, true, false, true, true);
  }, [index, lesson, navigate, recordCompletion, stopAutomation]);

  const onSectionEnd = useCallback(() => {
    if (handledBoundary.current === boundaryGeneration.current) return;
    handledBoundary.current = boundaryGeneration.current;
    if (repeatNumber.current < drill.repeats) {
      repeatNumber.current++;
      recordSignal(segment, 'replay');
      navigate(index, true, false, true);
      return;
    }
    repeatNumber.current = 1;
    if (drill.reveal === 'after-pause' && !revealed) void revealTranslation();
    const generation = automationId.current;
    if (drillRunning && drill.preset === 'drill') {
      void recorder.current?.recordFor(drill.responseSeconds).then((ok) => {
        if (generation !== automationId.current) return;
        if (ok) automaticContinue();
        else stopAutomation();
      });
    } else if (drill.pause === 'timed') {
      responseTimer.current = setTimeout(() => {
        if (generation === automationId.current) automaticContinue();
      }, drill.responseSeconds * 1000);
    }
  }, [
    drill,
    drillRunning,
    index,
    segment,
    recordSignal,
    navigate,
    revealed,
    revealTranslation,
    automaticContinue,
    stopAutomation,
  ]);

  function selectPreset(preset: PracticePreset) {
    stopAutomation();
    setDrill(practicePreset(preset));
    setMode(preset === 'continuous' ? 'continuous' : 'shadowing');
    resetTranslation();
  }

  async function startHandsFree() {
    stopAutomation();
    const generation = automationId.current;
    setDrillPreparing(true);
    const allowed = await recorder.current?.prepare();
    if (generation !== automationId.current) return;
    setDrillPreparing(false);
    if (!allowed) return;
    setDrillRunning(true);
    navigate(index, true, false, true);
  }

  usePlaybackBoundary({
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
  });
  function replayEvidence(evidence: QuizEvidence, questionLabel?: string) {
    stopAutomation();
    setEvidenceQuestion(questionLabel ?? 'Your comprehension question');
    const evidenceSection = lesson.segments.find((s) => s.id === evidence.segmentIds[0]);
    if (evidenceSection) recordSignal(evidenceSection, 'evidence-replay');
    if (replayResumeIndex.current === null) replayResumeIndex.current = index;
    setReplayRange(evidence);
    navigate(
      lesson.segments.findIndex((s) => s.id === evidence.segmentIds[0]),
      true,
      true,
    );
    practiceArea.current?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  }
  function returnToQuiz() {
    const resume = replayResumeIndex.current;
    setReplayRange(null);
    replayResumeIndex.current = null;
    setSecondaryTool('review');
    media.current?.pause();
    if (resume !== null) navigate(resume, false);
    requestAnimationFrame(() => {
      document.getElementById('lesson-quiz')?.scrollIntoView({
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'instant'
          : 'smooth',
        block: 'start',
      });
      const question = document.querySelector<HTMLElement>('#lesson-quiz .quiz-question');
      (question ?? document.getElementById('lesson-quiz'))?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        element.closest(
          'input, textarea, select, audio, video, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [data-lookup], dialog',
        ) ||
        ([' ', 'Enter'].includes(event.key) && element.closest('button,a,[role="button"]')) ||
        document.querySelector('dialog[open]') ||
        !ready ||
        recording ||
        quizOpen
      )
        return;
      const actions: Record<string, () => void> = {
        ' ': togglePlayback,
        r: replaySection,
        R: replaySection,
        Enter: continuePractice,
        ArrowLeft: () => navigate(index - 1),
        ArrowRight: () => navigate(index + 1),
        t: () => void revealTranslation(),
        T: () => void revealTranslation(),
      };
      const action = actions[event.key];
      if (action) {
        event.preventDefault();
        action();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    ready,
    recording,
    togglePlayback,
    navigate,
    index,
    continuePractice,
    revealTranslation,
    quizOpen,
    replaySection,
  ]);

  const onPlaying = useCallback((playing: boolean) => {
    setStatus((current) => (playing ? 'listening' : current === 'listening' ? 'paused' : current));
  }, []);
  const onReady = useCallback(() => {
    setReady(true);
    setPlaybackError('');
    media.current?.setSpeed(speed);
  }, [speed]);
  const onEnded = useCallback(() => {
    if (replayRange) {
      setStatus('paused');
      return;
    }
    if (mode === 'shadowing' && readPlaybackTime() < segment.end - 0.08) return;
    setStatus(mode === 'shadowing' ? 'your-turn' : 'complete');
    setElapsed(duration);
    if (mode === 'shadowing') onSectionEnd();
    if (mode === 'continuous') {
      setFinished(true);
      setSecondaryTool('review');
      setCompleted(true);
      completeLesson(lesson);
      recordCompletion();
    }
  }, [
    mode,
    duration,
    lesson,
    replayRange,
    recordCompletion,
    onSectionEnd,
    readPlaybackTime,
    segment.end,
  ]);
  const onMediaError = useCallback(
    (message: string) => {
      stopAutomation();
      setPlaybackError(message);
      setStatus('paused');
    },
    [stopAutomation],
  );
  const pauseForRecording = useCallback((automatic = false) => {
    if (!automatic) {
      automationId.current++;
      if (responseTimer.current) clearTimeout(responseTimer.current);
      responseTimer.current = null;
      setDrillRunning(false);
    }
    media.current?.pause();
    setStatus('your-turn');
  }, []);
  const toggleFavorite = () => {
    recordSignal(segment, 'bookmark');
    setFavorites((current) =>
      isFavorite ? current.filter((id) => id !== segment.id) : [...current, segment.id],
    );
  };
  const analyzeShadowing = useCallback(
    async (recordingBlob: Blob, recordingDurationSeconds: number) => {
      if (scoreAbort.current) return false;
      const target = segment;
      const owner = storageAccount();
      const referenceDurationSeconds = (target.end - target.start) / speed;
      try {
        validateShadowingRecordingBeforeUpload(recordingDurationSeconds, referenceDurationSeconds);
      } catch (error) {
        setScoringError(
          error instanceof Error ? error.message : 'Try recording the full section again.',
        );
        return false;
      }

      const controller = new AbortController();
      scoreAbort.current = controller;
      setScoringSection(target.id);
      setScoringError('');
      try {
        const transcription = await transcribeShadowingRecording(
          recordingBlob,
          recordingDurationSeconds,
          controller.signal,
        );
        const recognizedSpeechDurationSeconds = Math.max(
          0,
          transcription.speechEnd - transcription.speechStart,
        );
        const analysis = await deterministicShadowingAnalysis({
          targetText: target.japanese,
          recognizedText: transcription.recognizedText,
          referenceDurationSeconds,
          recordingDurationSeconds: recognizedSpeechDurationSeconds,
        });
        const suggestions = await shadowingAttemptFeedback(analysis, controller.signal);
        if (controller.signal.aborted || storageAccount() !== owner) return false;
        const result = {
          ...analysis,
          sectionId: target.id,
          attemptedAt: new Date().toISOString(),
          suggestions,
        };
        summaryAbort.current?.abort();
        summaryAbort.current = null;
        setSummaryLoading(false);
        setShadowingScores((current) => {
          if (controller.signal.aborted || storageAccount() !== owner) return current;
          const next = upsertShadowingSection(current, lesson.id, shadowingRevision, result);
          saveShadowingSession(next);
          return next;
        });
        return true;
      } catch (error) {
        if (!controller.signal.aborted)
          setScoringError(
            error instanceof Error
              ? error.message
              : 'This attempt could not be analysed. Your previous valid score is unchanged.',
          );
        return false;
      } finally {
        if (scoreAbort.current === controller) scoreAbort.current = null;
        if (!controller.signal.aborted) setScoringSection(null);
      }
    },
    [lesson.id, segment, shadowingRevision, speed],
  );

  const referenceSource = lessonMedia(lesson);
  const accessibleReference =
    referenceSource.type === 'demo' ||
    (referenceSource.type === 'local' && !!localMediaFile(lesson.mediaUrl));
  const referenceAudio = useCallback(
    async (signal: AbortSignal) => {
      const { extractMediaAudioRange } = await import('@/lib/transcription-client');
      let file = localMediaFile(lesson.mediaUrl);
      if (lessonMedia(lesson).type === 'demo') {
        const response = await fetch('/demo.mp4', { signal });
        if (!response.ok) throw new Error('Reference audio is unavailable.');
        const blob = await response.blob();
        file = new File([blob], 'demo.mp4', { type: 'video/mp4' });
      }
      if (!file) throw new Error('Reattach the local media to compare its audio.');
      const start = Math.max(0, segment.start + playbackOffsetMs / 1000);
      const end = segment.end + playbackOffsetMs / 1000;
      const recording = await extractMediaAudioRange(file, start, end, signal);
      return { recording, durationSeconds: end - start, playbackSpeed: speed };
    },
    [lesson, segment.start, segment.end, playbackOffsetMs, speed],
  );

  function reattach(file: File | undefined) {
    if (!file) return;
    try {
      validateMediaFile(file);
    } catch (error) {
      setPlaybackError((error as Error).message);
      return;
    }
    const mediaUrl = localMediaUrl(file);
    setLesson((current) => ({ ...current, mediaUrl }));
    setReady(false);
  }

  return (
    <main
      className={`practice-main${studioMode ? ' studio-mode' : ''}`}
      onClickCapture={progress.interact}
      onKeyDownCapture={(event) => {
        if (!event.repeat) progress.interact();
      }}
    >
      {progress.warning ? (
        <p className="small error-message" role="status">
          Progress for this visit may not be saved.
        </p>
      ) : null}
      <div className="practice-breadcrumb">
        <Link href="/">
          <ArrowLeft size={14} />
          Your practice
        </Link>
        <span>/</span>
        <span>{sourceLabel(lesson)}</span>
        <span className="studio-lesson-identity">{lesson.title}</span>
        {studioMode ? (
          <nav className="studio-navigation" aria-label="Studio navigation">
            <Link href="/library">Library</Link>
            <Link href="/dictionary">Vocabulary</Link>
            <Link href="/progress">Progress</Link>
            <Link href="/account">Account</Link>
            <button className="button" onClick={() => setStudioMode(false)}>
              Exit Studio
            </button>
          </nav>
        ) : (
          <span className="private-label">One sentence at a time.</span>
        )}
        <div className="practice-view-controls" aria-label="Practice display">
          <button
            className="button"
            aria-pressed={studioMode}
            onClick={() => setStudioMode((value) => !value)}
          >
            <PanelTop size={16} />
            Studio Mode
          </button>
          <button
            className="button"
            aria-pressed={furigana}
            onClick={() => setFurigana((value) => !value)}
          >
            <Languages size={16} />
            Furigana
          </button>
        </div>
      </div>
      <div className="practice-title">
        <div>
          <span className="eyebrow">
            {lesson.source === 'demo' ? 'A MOMENT FOR YOUR JAPANESE' : 'YOUR LISTENING SESSION'}
          </span>
          <h1>{lesson.title}</h1>
          <p>
            {lesson.author}
            <span>·</span>
            {lesson.segments.length} sections<span>·</span>
            {timestamp(duration)}
          </p>
        </div>
        <div className="practice-progress">
          <span>
            {index + 1}
            <span> / {lesson.segments.length}</span>
          </span>
          <div>
            <i style={{ width: `${((index + 1) / lesson.segments.length) * 100}%` }} />
          </div>
          <span className="small muted">Section position</span>
        </div>
      </div>
      <div className="practice-grid" ref={practiceArea}>
        <div className="player-column">
          <MediaPlayer
            ref={media}
            lesson={lesson}
            initialTime={
              returnPosition?.mediaTime ?? mediaTimeFor(lesson.segments[openingIndex].start)
            }
            speed={speed}
            onReady={onReady}
            onPlaying={onPlaying}
            onEnded={onEnded}
            onError={onMediaError}
          />
          {replayRange ? (
            <div className="evidence-banner" role="status">
              <span>
                {evidenceQuestion} · Replay {timestamp(replayRange.start)} –{' '}
                {timestamp(replayRange.end)}
                <small>Your answer is kept. Playback stops at the end of this excerpt.</small>
              </span>
              <button className="button" onClick={returnToQuiz}>
                Return to question
                <ArrowRight size={16} />
              </button>
            </div>
          ) : null}
          {lessonMedia(lesson).type === 'local' && !lesson.mediaUrl ? (
            <label className="reattach button">
              <Upload size={16} />
              Reattach {lesson.mediaName || 'your media'}
              <input
                aria-label="Reattach media"
                type="file"
                accept={MEDIA_ACCEPT}
                onChange={(event) => reattach(event.target.files?.[0])}
              />
            </label>
          ) : null}
          <div className="practice-settings-stack">
            <div className="player-settings">
              <div className="playback-adjustments">
                <label className="speed-control">
                  Speed
                  <select
                    aria-label="Playback speed"
                    value={speed}
                    disabled={recording}
                    onChange={(event) => {
                      stopAutomation();
                      setSpeed(Number(event.target.value));
                    }}
                  >
                    <option value="0.5">0.5×</option>
                    <option value="0.75">0.75×</option>
                    <option value="1">1×</option>
                    <option value="1.25">1.25×</option>
                  </select>
                </label>
                <div
                  className="offset-control"
                  role="group"
                  aria-label="Playback timing offset"
                  title="Positive shifts section timing later; negative shifts it earlier. Select the value to reset."
                >
                  <span>Subtitle sync</span>
                  <button
                    type="button"
                    aria-label="Shift playback timing 50 milliseconds earlier"
                    disabled={playbackOffsetMs <= PLAYBACK_OFFSET_MIN_MS}
                    onClick={() => {
                      stopAutomation();
                      setPlaybackOffsetMs((value) =>
                        Math.max(PLAYBACK_OFFSET_MIN_MS, value - PLAYBACK_OFFSET_STEP_MS),
                      );
                    }}
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="offset-value"
                    aria-label="Reset playback timing offset"
                    onClick={() => {
                      stopAutomation();
                      setPlaybackOffsetMs(0);
                    }}
                  >
                    {playbackOffsetMs > 0 ? '+' : ''}
                    {playbackOffsetMs} ms
                  </button>
                  <button
                    type="button"
                    aria-label="Shift playback timing 50 milliseconds later"
                    disabled={playbackOffsetMs >= PLAYBACK_OFFSET_MAX_MS}
                    onClick={() => {
                      stopAutomation();
                      setPlaybackOffsetMs((value) =>
                        Math.min(PLAYBACK_OFFSET_MAX_MS, value + PLAYBACK_OFFSET_STEP_MS),
                      );
                    }}
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="drill-settings" role="group" aria-label="Practice presets">
              <label>
                Preset
                <select
                  aria-label="Practice preset"
                  value={drill.preset}
                  disabled={recording || drillPreparing}
                  onChange={(event) => selectPreset(event.target.value as PracticePreset)}
                >
                  <option value="focus">Focus — listen, pause, repeat</option>
                  <option value="support">Support — meaning after a pause</option>
                  <option value="drill">Drill — listen twice, record</option>
                  <option value="continuous">Continuous — listen through</option>
                </select>
              </label>
              <details className="drill-advanced">
                <summary>Advanced settings{customized ? ' · Customized' : ''}</summary>
                <div className="drill-advanced-fields">
                  <label>
                    Source repeats
                    <select
                      aria-label="Source repeat count"
                      value={drill.repeats}
                      disabled={mode === 'continuous' || recording || drillRunning}
                      onChange={(event) => {
                        stopAutomation();
                        setDrill((current) => ({
                          ...current,
                          repeats: Number(event.target.value),
                        }));
                      }}
                    >
                      {[1, 2, 3].map((count) => (
                        <option key={count} value={count}>
                          {count}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Pause
                    <select
                      aria-label="Section pause behavior"
                      value={drill.pause}
                      disabled={mode === 'continuous' || recording || drillRunning}
                      onChange={(event) => {
                        stopAutomation();
                        setDrill((current) => ({
                          ...current,
                          pause: event.target.value as 'manual' | 'timed',
                        }));
                      }}
                    >
                      <option value="manual">Until I continue</option>
                      <option value="timed">Timed speaking window</option>
                    </select>
                  </label>
                  <label>
                    Translation
                    <select
                      aria-label="Translation reveal behavior"
                      value={drill.reveal}
                      disabled={mode === 'continuous' || recording || drillRunning}
                      onChange={(event) => {
                        stopAutomation();
                        setDrill((current) => ({
                          ...current,
                          reveal: event.target.value as 'manual' | 'after-pause',
                        }));
                      }}
                    >
                      <option value="manual">Reveal on request</option>
                      <option value="after-pause">Reveal after source repeats</option>
                    </select>
                  </label>
                  {drill.pause === 'timed' || drill.preset === 'drill' ? (
                    <label>
                      Speaking window (seconds)
                      <input
                        aria-label="Speaking window seconds"
                        type="number"
                        min={2}
                        max={30}
                        value={drill.responseSeconds}
                        disabled={recording || drillRunning}
                        onChange={(event) => {
                          const seconds = Number(event.target.value);
                          if (Number.isInteger(seconds) && seconds >= 2 && seconds <= 30) {
                            stopAutomation();
                            setDrill((current) => ({ ...current, responseSeconds: seconds }));
                          }
                        }}
                      />
                    </label>
                  ) : null}
                </div>
              </details>
              {drill.preset === 'drill' ? (
                <button
                  className="button"
                  disabled={!ready || (!drillRunning && recording)}
                  onClick={() => {
                    if (drillRunning || drillPreparing) {
                      stopAutomation();
                      media.current?.pause();
                      setStatus('paused');
                    } else void startHandsFree();
                  }}
                >
                  {drillPreparing
                    ? 'Cancel microphone request'
                    : drillRunning
                      ? 'Stop hands-free drill'
                      : 'Start hands-free drill'}
                </button>
              ) : null}
              {mode === 'shadowing' && drill.pause === 'timed' && !drillRunning ? (
                <button
                  className="button"
                  onClick={() => {
                    stopAutomation();
                    setDrill((current) => ({ ...current, pause: 'manual' }));
                    media.current?.pause();
                    setStatus('paused');
                  }}
                >
                  Stop timed practice
                </button>
              ) : null}
              <p className="small muted">
                {mode === 'continuous'
                  ? 'Continuous follows the media without repeats or automatic section pauses.'
                  : `${drill.repeats} source ${drill.repeats === 1 ? 'play' : 'plays'} → ${drillRunning ? `${drill.responseSeconds} s local recording → next section` : drill.pause === 'timed' ? `${drill.responseSeconds} s to speak → next section` : 'pause until Continue'}.`}
                {drill.preset === 'drill'
                  ? ' Hands-free needs your microphone permission; recordings are local and analysis stays explicit.'
                  : ''}
              </p>
            </div>
          </div>
          <div className="practice-current-stack">
            <CurrentSection
              lesson={lesson}
              recording={recording}
              status={status}
              stateLabel={stateLabel}
              segment={segment}
              furigana={furigana}
              revealed={revealed}
              translating={translating}
              revealTranslation={revealTranslation}
              isFavorite={isFavorite}
              toggleFavorite={toggleFavorite}
              translation={translation}
              translationProvider={translationProvider}
              translationError={translationError}
              setTranslationError={setTranslationError}
              percent={percent}
              ready={ready}
              index={index}
              navigate={navigate}
              replaySection={replaySection}
              mode={mode}
              isPlaying={isPlaying}
              togglePlayback={togglePlayback}
              continuePractice={continuePractice}
              lastIndex={lesson.segments.length - 1}
            />

            <VoiceRecorder
              ref={recorder}
              key={segment.id}
              enabled={ready && !isPlaying}
              nativePlaying={isPlaying}
              onBeforeRecord={pauseForRecording}
              onRecording={setRecording}
              onAttempt={() => recordSignal(segment, 'recording-attempt')}
              analysis={currentShadowingResult}
              analyzing={scoringSection === segment.id}
              analysisError={scoringError}
              onAnalyze={analyzeShadowing}
              onNewRecording={() => setScoringError('')}
              recentAttempts={shadowingScores.recentAttempts?.[segment.id]}
              onManualStop={stopAutomation}
              referenceAudio={accessibleReference ? referenceAudio : undefined}
              onReplayNative={replaySection}
            />
          </div>
          <nav className="practice-tool-navigation" aria-label="Lesson tools">
            {(
              [
                ['transcript', 'Transcript', 'practice-transcript'],
                ['vocabulary', 'Vocabulary', 'practice-vocabulary'],
                ['review', 'Lesson review', 'practice-review'],
              ] as const
            ).map(([tool, label, target]) => (
              <button
                key={tool}
                className="button"
                aria-pressed={secondaryTool === tool}
                aria-controls={target}
                onClick={() => {
                  setSecondaryTool(tool);
                  if (!studioMode)
                    document.getElementById(target)?.scrollIntoView({
                      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'instant'
                        : 'smooth',
                      block: 'start',
                    });
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div
            id="practice-vocabulary"
            className="practice-secondary-pane"
            hidden={studioMode && secondaryTool !== 'vocabulary'}
          >
            <LessonVocabulary
              lesson={lesson}
              onPractice={(sectionId) => {
                const targetIndex = lesson.segments.findIndex((s) => s.id === sectionId);
                if (targetIndex >= 0) navigate(targetIndex, ready);
              }}
              onFilter={filterRecommendations}
              filterActive={recommendedSegmentIds !== null}
            />
          </div>
          <div
            id="practice-review"
            className="practice-secondary-pane"
            hidden={studioMode && secondaryTool !== 'review'}
          >
            <LessonCompletionSummary
              lesson={lesson}
              finished={finished}
              scores={shadowingScores}
              aggregate={shadowingAggregate}
              summary={currentShadowingSummary}
              summaryLoading={summaryLoading}
              onSummarize={isPro ? summarizeShadowing : undefined}
              onPracticeAgain={() => navigate(0, false)}
              onReview={(segmentIndex) => navigate(segmentIndex)}
              favorites={favorites}
              onDifficultyWaiting={setDifficultyWaiting}
              quiz={{
                furigana,
                ready,
                recording,
                replaying: !!replayRange,
                onReplay: replayEvidence,
                onReturn: returnToQuiz,
                onOpenChange: (open) => {
                  if (open) setSecondaryTool('review');
                  stopAutomation();
                  setQuizOpen(open);
                  if (!open && replayRange) returnToQuiz();
                  else if (open) {
                    media.current?.pause();
                    setStatus('paused');
                  }
                },
                available: completed,
              }}
            />
          </div>
          {playbackError ? (
            <p role="alert" className="error-message">
              {playbackError}
            </p>
          ) : null}
          <div className="player-footnote">
            <span>
              {lesson.source === 'demo'
                ? 'Studio sample · Japanese synthetic voice'
                : lesson.transcriptSource}
            </span>
            <button className="text-button" onClick={onHelp}>
              <Keyboard size={14} />
              Shortcuts
            </button>
          </div>
          {!segment.translation ? (
            <p className="translation-privacy">
              Revealing a translation sends this Japanese section plus up to one neighboring
              Japanese section on each side for context. It never includes your recordings, quiz
              results, or learner history.
            </p>
          ) : null}
        </div>
        <TranscriptPanel
          hidden={studioMode && secondaryTool !== 'transcript'}
          lesson={lesson}
          index={index}
          favorites={favorites}
          recording={recording}
          ready={ready}
          furigana={furigana}
          mode={mode}
          practiceCount={practiceCount}
          navigate={navigate}
          recommendedSegmentIds={recommendedSegmentIds}
          onClearRecommendations={() => setRecommendedSegmentIds(null)}
        />
      </div>
      <div className="practice-signoff">
        <span lang="ja">焦らず、少しずつ。</span>
        <span>No rush. Just a little closer.</span>
      </div>
    </main>
  );
}
