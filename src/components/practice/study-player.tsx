'use client';
import { CurrentSection } from './current-section';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Headphones,
  Mic,
  Check,
  Languages,
  Keyboard,
  Upload,
  PanelTop,
} from 'lucide-react';
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
import { timestamp } from '@/lib/youtube';
import { MediaPlayer, type MediaHandle } from '../media-player';
import { VoiceRecorder } from '../voice-recorder';
import { ComprehensionQuiz } from '../comprehension-quiz';
import { LessonDifficulty } from '../lesson-difficulty';
import { ShadowingCompletion } from '../shadowing-completion';
import { TopicVocabularyOverview } from '../topic-vocabulary-overview';
import { LessonReviewRecap } from '../lesson-review-recap';
import { useProAccess } from '../pro-feature';
import { transcriptRevision } from '@/lib/transcript';
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
  const [index, setIndex] = useState(session.index);
  const [mode, setMode] = useState<Mode>(session.preferences.mode);
  const [speed, setSpeed] = useState(session.preferences.speed);
  const [playbackOffsetMs, setPlaybackOffsetMs] = useState(session.preferences.playbackOffsetMs);
  const [studioMode, setStudioMode] = useState(session.preferences.studioMode);
  const [furigana, setFurigana] = useState(session.preferences.furigana);
  const [status, setStatus] = useState<PlaybackState>('ready');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [elapsed, setElapsed] = useState(lesson.segments[session.index].start);
  const [shadowingScores, setShadowingScores] = useState(() =>
    loadShadowingSession(session.lesson.id, shadowingRevision),
  );
  const [scoringSection, setScoringSection] = useState<string | null>(null);
  const [scoringError, setScoringError] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const scoreAbort = useRef<AbortController | null>(null);
  const summaryAbort = useRef<AbortController | null>(null);

  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(lesson));

  const [finished, setFinished] = useState(false);
  const [topicOverviewOpen, setTopicOverviewOpen] = useState(false);
  const [completed, setCompleted] = useState(() => lessonCompleted(session.lesson));
  const [quizOpen, setQuizOpen] = useState(false);
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
  } = useSectionTranslation(lesson, index, session.index, recordSignal);
  const recordCompletion = progress.complete;
  const isFavorite = favorites.includes(segment.id);

  const duration = lesson.segments.at(-1)!.end;
  const percent = Math.min(
    100,
    Math.max(0, ((elapsed - segment.start) / (segment.end - segment.start)) * 100),
  );
  const stateLabel = recording
    ? 'RECORDING'
    : {
        ready: 'READY WHEN YOU ARE',
        listening: 'LISTEN CLOSELY',
        paused: 'TAKE A BREATH',
        'your-turn': 'YOUR TURN',
        complete: 'WELL PRACTICED',
      }[status];
  useEffect(() => {
    const hydrate = () => {
      const prefs = loadPreferences();
      setMode(prefs.mode);
      setSpeed(prefs.speed);
      setPlaybackOffsetMs(prefs.playbackOffsetMs);
      setStudioMode(prefs.studioMode);
      setFurigana(prefs.furigana);
      setFavorites(loadFavorites(lesson));
      setCompleted(lessonCompleted(lesson));
    };
    window.addEventListener('hibiki:sync-hydrated', hydrate);
    return () => window.removeEventListener('hibiki:sync-hydrated', hydrate);
  }, [lesson]);
  useEffect(() => {
    saveLesson(lesson, index);
  }, [lesson, index]);
  useEffect(() => {
    writeStorage('preferences', {
      mode,
      speed,
      playbackOffsetMs,
      translation: false,
      studioMode,
      furigana,
    });
  }, [mode, speed, playbackOffsetMs, studioMode, furigana]);
  useEffect(() => {
    document.body.classList.toggle('studio-active', studioMode);
    return () => document.body.classList.remove('studio-active');
  }, [studioMode]);
  useEffect(() => {
    media.current?.setSpeed(speed);
  }, [speed]);

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

  useEffect(() => {
    if (!isPro || !finished || !shadowingSignals) return;
    if (shadowingScores.summary?.fingerprint === shadowingSignals.fingerprint) return;
    if (summaryAbort.current) return;
    const controller = new AbortController();
    summaryAbort.current = controller;
    setSummaryLoading(true);
    void shadowingSessionSummary(shadowingSignals, controller.signal)
      .then((summary) => {
        if (controller.signal.aborted) return;
        setShadowingScores((current) => {
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
    return () => controller.abort();
  }, [finished, isPro, shadowingSignals, shadowingScores.summary?.fingerprint]);

  const navigate = useCallback(
    (nextIndex: number, play = true, evidenceReplay = false) => {
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
      media.current?.pause();
      media.current?.seek(mediaTarget);
      seeking.current = { target: mediaTarget, deadline: Date.now() + 4000 };
      setIndex(next);
      setElapsed(target.start);
      setStatus(play ? 'listening' : 'ready');
      setFinished(false);
      setPlaybackError('');
      if (next !== index) resetTranslation();
      if (play)
        void media.current?.play().catch(() => {
          setStatus('paused');
          setPlaybackError('Playback didn’t start. Press play inside the video, then try again.');
        });
    },
    [lesson.segments, index, resetTranslation, recordSignal, mediaTimeFor],
  );
  const replaySection = useCallback(() => {
    recordSignal(segment, 'replay');
    navigate(index);
  }, [recordSignal, segment, navigate, index]);
  const togglePlayback = useCallback(() => {
    if (isPlaying) {
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
  }, [isPlaying, mode, status, segment.end, navigate, index, playbackOffsetSeconds]);
  const continuePractice = useCallback(() => {
    if (index === lesson.segments.length - 1) {
      media.current?.pause();
      setStatus('complete');
      setFinished(true);
      setTopicOverviewOpen(true);
      setCompleted(true);
      completeLesson(lesson);
      recordCompletion();
      setPracticeCount((n) => n + 1);
      return;
    }
    setPracticeCount((n) => n + 1);
    navigate(index + 1);
  }, [index, lesson, navigate, recordCompletion]);

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
  });
  function replayEvidence(evidence: QuizEvidence) {
    const evidenceSection = lesson.segments.find((s) => s.id === evidence.segmentIds[0]);
    if (evidenceSection) recordSignal(evidenceSection, 'evidence-replay');
    if (replayResumeIndex.current === null) replayResumeIndex.current = index;
    setReplayRange(evidence);
    navigate(
      lesson.segments.findIndex((s) => s.id === evidence.segmentIds[0]),
      true,
      true,
    );
    practiceArea.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function returnToQuiz() {
    const resume = replayResumeIndex.current;
    setReplayRange(null);
    replayResumeIndex.current = null;
    media.current?.pause();
    if (resume !== null) navigate(resume, false);
    document.getElementById('lesson-quiz')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('lesson-quiz')?.focus({ preventScroll: true });
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.repeat ||
        element.closest(
          'input, textarea, select, audio, video, [contenteditable="true"], dialog',
        ) ||
        ([' ', 'Enter'].includes(event.key) && element.closest('button,a')) ||
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
    setStatus(mode === 'shadowing' ? 'your-turn' : 'complete');
    setElapsed(duration);
    if (mode === 'continuous') {
      setFinished(true);
      setTopicOverviewOpen(true);
      setCompleted(true);
      completeLesson(lesson);
      recordCompletion();
    }
  }, [mode, duration, lesson, replayRange, recordCompletion]);
  const onMediaError = useCallback((message: string) => {
    setPlaybackError(message);
    setStatus('paused');
  }, []);
  const pauseForRecording = useCallback(() => {
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
        if (controller.signal.aborted) return false;
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

  function reattach(file: File | undefined) {
    if (!file) return;
    try {
      validateMediaFile(file);
    } catch (error) {
      setPlaybackError((error as Error).message);
      return;
    }
    const mediaUrl = URL.createObjectURL(file);
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
        <span className="private-label">One sentence at a time.</span>
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
          <span className="small muted">a little closer</span>
        </div>
      </div>
      <div className="practice-grid" ref={practiceArea}>
        <div className="player-column">
          <MediaPlayer
            ref={media}
            lesson={lesson}
            initialTime={mediaTimeFor(lesson.segments[session.index].start)}
            speed={speed}
            onReady={onReady}
            onPlaying={onPlaying}
            onEnded={onEnded}
            onError={onMediaError}
          />
          {replayRange ? (
            <div className="evidence-banner" role="status">
              <span>
                Lesson evidence · {timestamp(replayRange.start)} – {timestamp(replayRange.end)}
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
          <div className="player-settings">
            <div className="segmented-control" aria-label="Playback mode">
              <button
                className={mode === 'shadowing' ? 'selected' : ''}
                aria-pressed={mode === 'shadowing'}
                onClick={() => setMode('shadowing')}
              >
                <Mic size={14} />
                Shadowing
              </button>
              <button
                className={mode === 'continuous' ? 'selected' : ''}
                aria-pressed={mode === 'continuous'}
                onClick={() => setMode('continuous')}
              >
                <Headphones size={14} />
                Continuous
              </button>
            </div>
            <div className="playback-adjustments">
              <label className="speed-control">
                Speed
                <select
                  aria-label="Playback speed"
                  value={speed}
                  onChange={(event) => setSpeed(Number(event.target.value))}
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
                <span>Offset</span>
                <button
                  type="button"
                  aria-label="Shift playback timing 50 milliseconds earlier"
                  disabled={playbackOffsetMs <= PLAYBACK_OFFSET_MIN_MS}
                  onClick={() =>
                    setPlaybackOffsetMs((value) =>
                      Math.max(PLAYBACK_OFFSET_MIN_MS, value - PLAYBACK_OFFSET_STEP_MS),
                    )
                  }
                >
                  −
                </button>
                <button
                  type="button"
                  className="offset-value"
                  aria-label="Reset playback timing offset"
                  onClick={() => setPlaybackOffsetMs(0)}
                >
                  {playbackOffsetMs > 0 ? '+' : ''}
                  {playbackOffsetMs} ms
                </button>
                <button
                  type="button"
                  aria-label="Shift playback timing 50 milliseconds later"
                  disabled={playbackOffsetMs >= PLAYBACK_OFFSET_MAX_MS}
                  onClick={() =>
                    setPlaybackOffsetMs((value) =>
                      Math.min(PLAYBACK_OFFSET_MAX_MS, value + PLAYBACK_OFFSET_STEP_MS),
                    )
                  }
                >
                  +
                </button>
              </div>
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
            />
          </div>
          {isPro && finished && shadowingAggregate ? (
            <ShadowingCompletion
              aggregate={shadowingAggregate}
              summary={currentShadowingSummary}
              loading={summaryLoading}
            />
          ) : null}
          {topicOverviewOpen ? (
            <TopicVocabularyOverview
              lesson={lesson}
              onReview={(segmentIndex) => navigate(segmentIndex)}
            />
          ) : null}
          {finished ? <LessonReviewRecap lesson={lesson} /> : null}
          {finished ? (
            <div className="completion-card" role="status">
              <span>
                <Check size={20} />
              </span>
              <div>
                <strong>You made a little progress today.</strong>
                <p>Every repetition helps the rhythm feel more familiar.</p>
              </div>
              <button
                className="text-button"
                onClick={() => {
                  setTopicOverviewOpen(false);
                  navigate(0, false);
                }}
              >
                Practice again
                <RotateCcw size={14} />
              </button>
            </div>
          ) : null}
          {completed ? (
            <ComprehensionQuiz
              furigana={furigana}
              lesson={lesson}
              ready={ready}
              recording={recording}
              replaying={!!replayRange}
              onReplay={replayEvidence}
              onReturn={returnToQuiz}
              onOpenChange={(open) => {
                setQuizOpen(open);
                if (!open && replayRange) returnToQuiz();
                else if (open) {
                  media.current?.pause();
                  setStatus('paused');
                }
              }}
            />
          ) : null}
          {playbackError ? (
            <p role="alert" className="error-message">
              {playbackError}
            </p>
          ) : null}
          <LessonDifficulty lesson={lesson} onWaitingChange={setDifficultyWaiting} />
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
          lesson={lesson}
          index={index}
          favorites={favorites}
          recording={recording}
          ready={ready}
          furigana={furigana}
          mode={mode}
          practiceCount={practiceCount}
          navigate={navigate}
        />
      </div>
      <div className="practice-signoff">
        <span lang="ja">焦らず、少しずつ。</span>
        <span>No rush. Just a little closer.</span>
      </div>
    </main>
  );
}
