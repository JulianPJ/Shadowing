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
  type Preferences,
} from '@/lib/storage';
import { lessonMedia, sourceLabel, MEDIA_ACCEPT, validateMediaFile } from '@/lib/media';
import { timestamp } from '@/lib/youtube';
import { MediaPlayer, type MediaHandle } from '../media-player';
import { VoiceRecorder } from '../voice-recorder';
import { ComprehensionQuiz } from '../comprehension-quiz';
import { LessonDifficulty } from '../lesson-difficulty';

import { usePracticeProgress } from '../use-practice-progress';
import { useSectionTranslation } from './use-section-translation';
import { usePlaybackBoundary } from './use-playback-boundary';
import { TranscriptPanel } from './transcript-panel';
import type { ScoredShadowingSection, ShadowingScoreAnalysis } from '@/lib/shadowing-score';
import { shadowingSummaryFallback } from '@/lib/shadowing-score';
import {
  clearShadowingSession,
  loadShadowingSession,
  requestShadowingSummary,
  saveShadowingSession,
  shadowingAggregate,
} from '@/lib/shadowing-client';
export type Session = { lesson: Lesson; index: number; preferences: Preferences };
export function StudyPlayer({ session, onHelp }: { session: Session; onHelp: () => void }) {
  const [lesson, setLesson] = useState(session.lesson);
  const [index, setIndex] = useState(session.index);
  const [mode, setMode] = useState<Mode>(session.preferences.mode);
  const [speed, setSpeed] = useState(session.preferences.speed);
  const [studioMode, setStudioMode] = useState(session.preferences.studioMode);
  const [furigana, setFurigana] = useState(session.preferences.furigana);
  const [status, setStatus] = useState<PlaybackState>('ready');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [shadowingScores, setShadowingScores] = useState<ScoredShadowingSection[]>([]);
  const [shadowingSummary, setShadowingSummary] = useState<{
    whatWentWell: string;
    keepWorkingOn: string;
  } | null>(null);
  const [shadowingSummaryLoading, setShadowingSummaryLoading] = useState(false);
  const shadowingSummaryRequest = useRef<AbortController | null>(null);
  const [playbackError, setPlaybackError] = useState('');
  const [elapsed, setElapsed] = useState(lesson.segments[session.index].start);

  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(lesson));

  const [finished, setFinished] = useState(false);
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
  const readPlaybackTime = useCallback(() => media.current?.time() ?? 0, []);
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
  const recordShadowingScore = useCallback(
    (analysis: ShadowingScoreAnalysis) => {
      const entry: ScoredShadowingSection = {
        sectionId: segment.id,
        attemptId:
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        scoredAt: new Date().toISOString(),
        analysis,
      };
      setShadowingScores((current) => {
        const next = [...current.filter((value) => value.sectionId !== segment.id), entry];
        saveShadowingSession(lesson, next);
        return next;
      });
    },
    [lesson, segment.id],
  );
  const isFavorite = favorites.includes(segment.id);
  const currentShadowingScore = shadowingScores.find((value) => value.sectionId === segment.id);
  const overallShadowing = useMemo(
    () => shadowingAggregate(lesson, shadowingScores),
    [lesson, shadowingScores],
  );

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
    setShadowingScores(loadShadowingSession(lesson));
    setShadowingSummary(null);
    setShadowingSummaryLoading(false);
    shadowingSummaryRequest.current?.abort();
  }, [lesson.id, lesson.segments]);

  useEffect(() => {
    const hydrate = () => {
      const prefs = loadPreferences();
      setMode(prefs.mode);
      setSpeed(prefs.speed);
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
    writeStorage('preferences', { mode, speed, translation: false, studioMode, furigana });
  }, [mode, speed, studioMode, furigana]);
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

  const navigate = useCallback(
    (nextIndex: number, play = true, evidenceReplay = false) => {
      if (!evidenceReplay) {
        setReplayRange(null);
        replayResumeIndex.current = null;
      }
      const next = Math.min(Math.max(nextIndex, 0), lesson.segments.length - 1);
      const target = lesson.segments[next];
      if (!evidenceReplay) recordSignal(target, 'navigate');
      media.current?.pause();
      media.current?.seek(target.start);
      seeking.current = { target: target.start, deadline: Date.now() + 4000 };
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
    [lesson.segments, index, resetTranslation, recordSignal],
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
        media.current!.time() >= segment.end - 0.08)
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
  }, [isPlaying, mode, status, segment.end, navigate, index]);
  const continuePractice = useCallback(() => {
    if (index === lesson.segments.length - 1) {
      media.current?.pause();
      setStatus('complete');
      setFinished(true);
      setCompleted(true);
      completeLesson(lesson);
      recordCompletion();
      setPracticeCount((n) => n + 1);
      return;
    }
    setPracticeCount((n) => n + 1);
    navigate(index + 1);
  }, [index, lesson, navigate, recordCompletion]);

  useEffect(() => {
    shadowingSummaryRequest.current?.abort();
    if (!finished || !overallShadowing) {
      setShadowingSummaryLoading(false);
      if (!finished) setShadowingSummary(null);
      return;
    }
    const controller = new AbortController();
    shadowingSummaryRequest.current = controller;
    setShadowingSummaryLoading(true);
    const fallback = shadowingSummaryFallback(overallShadowing);
    void requestShadowingSummary(
      overallShadowing,
      shadowingScores,
      AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
    )
      .then((summary) => {
        if (!controller.signal.aborted) setShadowingSummary(summary);
      })
      .catch(() => {
        if (!controller.signal.aborted) setShadowingSummary(fallback);
      })
      .finally(() => {
        if (!controller.signal.aborted) setShadowingSummaryLoading(false);
      });
    return () => controller.abort();
  }, [finished, overallShadowing, shadowingScores]);

  useEffect(() => () => shadowingSummaryRequest.current?.abort(), []);

    usePlaybackBoundary({
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
  const restartPractice = useCallback(() => {
    clearShadowingSession(lesson);
    setShadowingScores([]);
    setShadowingSummary(null);
    setShadowingSummaryLoading(false);
    shadowingSummaryRequest.current?.abort();
    navigate(0, false);
  }, [lesson, navigate]);
  const toggleFavorite = () => {
    recordSignal(segment, 'bookmark');
    setFavorites((current) =>
      isFavorite ? current.filter((id) => id !== segment.id) : [...current, segment.id],
    );
  };
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
            initialTime={lesson.segments[session.index].start}
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
          </div>
          <CurrentSection
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
            target={segment}
            initialAnalysis={currentShadowingScore?.analysis}
            onBeforeRecord={pauseForRecording}
            onRecording={setRecording}
            onAttempt={() => recordSignal(segment, 'recording-attempt')}
            onScored={recordShadowingScore}
          />
          {finished && overallShadowing ? (
            <section className="shadowing-overall" data-testid="shadowing-overall" aria-live="polite">
              <div className="shadowing-overall-score">
                <span className="small-label">SHADOWING SCORE</span>
                <strong>{overallShadowing.score} <small>/ 100</small></strong>
                <p>
                  Scored {overallShadowing.scoredSections} of {overallShadowing.totalSections} shadowing sections
                </p>
              </div>
              {shadowingSummaryLoading && !shadowingSummary ? (
                <p className="small muted">Preparing your shadowing summary…</p>
              ) : shadowingSummary ? (
                <div className="shadowing-overall-feedback">
                  <div>
                    <span>What went well</span>
                    <p>{shadowingSummary.whatWentWell}</p>
                  </div>
                  <div>
                    <span>Keep working on</span>
                    <p>{shadowingSummary.keepWorkingOn}</p>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
          {finished ? (
            <div className="completion-card" role="status">
              <span>
                <Check size={20} />
              </span>
              <div>
                <strong>You made a little progress today.</strong>
                <p>Every repetition helps the rhythm feel more familiar.</p>
              </div>
              <button className="text-button" onClick={restartPractice}>
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
