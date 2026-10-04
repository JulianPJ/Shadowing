'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, RotateCcw, Play, Pause, Headphones, Mic, Check, Languages, Bookmark, Keyboard, Upload, LoaderCircle, Search, AudioLines } from 'lucide-react';
import demoData from '@/data/demo.json';
import type { Lesson, Mode, PlaybackState, QuizEvidence } from '@/lib/types';
import { validateCues } from '@/lib/segmentation';
import { readStorage, writeStorage, saveLesson, getLiveMedia, completeLesson, lessonCompleted, loadFavorites, loadTranslationCache, type Preferences } from '@/lib/storage';
import { timestamp } from '@/lib/youtube';
import { Header, Footer, HelpDialog } from './chrome';
import { MediaPlayer, type MediaHandle } from './media-player';
import { VoiceRecorder } from './voice-recorder';
import { ComprehensionQuiz } from './comprehension-quiz';
import { LessonDifficulty } from './lesson-difficulty';
import { usePracticeProgress } from './use-practice-progress';

type Session = { lesson: Lesson; index: number; preferences: Preferences };
export function Practice({ lessonId }: { lessonId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [missing, setMissing] = useState(false);
  const [help, setHelp] = useState(false);
  /* Browser-only lesson persistence requires a one-time sync after hydration. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const lesson = lessonId === 'demo' ? demoData as Lesson : readStorage<Lesson | null>(`lesson:${lessonId}`, null);
      if (!lesson || !lesson.segments?.length) { setMissing(true); return; }
      if (lesson.source === 'upload') lesson.mediaUrl = getLiveMedia(lesson.id);
      validateCues(lesson.segments);
      const rawIndex = readStorage<number>(`position:${lessonId}`, 0);
      const index = Number.isInteger(rawIndex) ? Math.max(0, Math.min(rawIndex, lesson.segments.length - 1)) : 0;
      const prefs = readStorage<Preferences>('preferences', { mode: 'shadowing', speed: 1, translation: false });
      const preferences: Preferences = { mode: prefs?.mode === 'continuous' ? 'continuous' : 'shadowing', speed: [0.5, 0.75, 1, 1.25].includes(prefs?.speed) ? prefs.speed : 1, translation: false };
      setSession({ lesson, index, preferences });
    } catch { setMissing(true); }
  }, [lessonId]);
  /* eslint-enable react-hooks/set-state-in-effect */
  return <><Header player onHelp={() => setHelp(true)} />{session ? <StudyPlayer key={session.lesson.id} session={session} onHelp={() => setHelp(true)} /> : <main className="empty-screen">{missing ? <><span className="eyebrow">A FRESH START</span><h1>This practice isn’t saved here yet.</h1><p>Lessons are saved in the browser where you prepared them. Paste your video link again or explore the sample.</p><Link className="button primary" href="/">Prepare a video <ArrowRight size={16} /></Link><Link className="button" href="/practice/demo">Try the demo</Link></> : <><LoaderCircle className="spin" size={24} /><p>Opening your practice…</p></>}</main>}<Footer /><HelpDialog player open={help} onClose={() => setHelp(false)} /></>;
}

function StudyPlayer({ session, onHelp }: { session: Session; onHelp: () => void }) {
  const [lesson, setLesson] = useState(session.lesson);
  const [index, setIndex] = useState(session.index);
  const [mode, setMode] = useState<Mode>(session.preferences.mode);
  const [speed, setSpeed] = useState(session.preferences.speed);
  const [status, setStatus] = useState<PlaybackState>('ready');
  const [ready, setReady] = useState(false);
  const [recording, setRecording] = useState(false);
  const [playbackError, setPlaybackError] = useState('');
  const [elapsed, setElapsed] = useState(lesson.segments[session.index].start);
  const [revealed, setRevealed] = useState(() => readStorage<unknown>(`reveal:${lesson.id}:${lesson.segments[session.index].id}`, false) === true);
  const [translations, setTranslations] = useState<Record<string, string>>(() => loadTranslationCache(lesson.id));
  const [translating, setTranslating] = useState(false);
  const [translationError, setTranslationError] = useState('');
  const [translationProvider, setTranslationProvider] = useState('');
  const [favorites, setFavorites] = useState<string[]>(() => loadFavorites(lesson));
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [finished, setFinished] = useState(false);
  const [completed, setCompleted] = useState(() => lessonCompleted(session.lesson));
  const [quizOpen, setQuizOpen] = useState(false);
  const [difficultyWaiting, setDifficultyWaiting] = useState(false);
  const [replayRange, setReplayRange] = useState<QuizEvidence | null>(null);
  const replayResumeIndex = useRef<number | null>(null);
  const playerColumn = useRef<HTMLDivElement>(null);
  const [practiceCount, setPracticeCount] = useState(0);
  const media = useRef<MediaHandle>(null);
  const transcript = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const seeking = useRef<{ target: number; deadline: number } | null>(null);
  const translationAbort = useRef<AbortController | null>(null);
  const segment = lesson.segments[index];
  const isPlaying = status === 'listening';
  const readPlaybackTime = useCallback(() => media.current?.time() ?? 0, []);
  const progress = usePracticeProgress(lesson, { playing: ready && isPlaying && !playbackError, recording, excluded: quizOpen || difficultyWaiting, yourTurn: status === 'your-turn' && !recording, segment, speed }, readPlaybackTime);
  const recordSignal = progress.signal;
  const recordCompletion = progress.complete;
  const isFavorite = favorites.includes(segment.id);
  const translation = segment.translation || translations[segment.id];
  const duration = lesson.segments.at(-1)!.end;
  const percent = Math.min(100, Math.max(0, (elapsed - segment.start) / (segment.end - segment.start) * 100));
  const stateLabel = recording ? 'RECORDING' : ({ ready: 'READY WHEN YOU ARE', listening: 'LISTEN CLOSELY', paused: 'TAKE A BREATH', 'your-turn': 'YOUR TURN', complete: 'WELL PRACTICED' })[status];
  useEffect(() => { saveLesson(lesson, index); }, [lesson, index]);
  useEffect(() => { writeStorage('preferences', { mode, speed, translation: false }); media.current?.setSpeed(speed); }, [mode, speed]);
  useEffect(() => { writeStorage(`reveal:${lesson.id}:${segment.id}`, revealed); }, [lesson.id, segment.id, revealed]);
  useEffect(() => { writeStorage(`translations:${lesson.id}`, translations); }, [lesson.id, translations]);
  useEffect(() => { writeStorage(`favorites:${lesson.id}`, favorites); }, [lesson.id, favorites]);
  useEffect(() => {
    const row = activeRow.current; const container = transcript.current;
    if (row && container) {
      const top = row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
      if (top < container.scrollTop + 12 || top + row.offsetHeight > container.scrollTop + container.clientHeight - 12) container.scrollTo({ top: Math.max(0, top - container.clientHeight / 2 + row.offsetHeight / 2), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }
  }, [index, search, onlyFavorites]);
  useEffect(() => () => { translationAbort.current?.abort(); }, []);

  const resetTranslation = useCallback(() => {
    translationAbort.current?.abort(); setTranslating(false); setTranslationError(''); setTranslationProvider(''); setRevealed(false);
  }, []);
  const navigate = useCallback((nextIndex: number, play = true, evidenceReplay = false) => {
    if (!evidenceReplay) { setReplayRange(null); replayResumeIndex.current = null; }
    const next = Math.min(Math.max(nextIndex, 0), lesson.segments.length - 1);
    const target = lesson.segments[next];
    if (!evidenceReplay) recordSignal(target, 'navigate');
    media.current?.pause(); media.current?.seek(target.start);
    seeking.current = { target: target.start, deadline: Date.now() + 4000 };
    setIndex(next); setElapsed(target.start); setStatus(play ? 'listening' : 'ready'); setFinished(false); setPlaybackError('');
    if (next !== index) resetTranslation();
    if (play) void media.current?.play().catch(() => { setStatus('paused'); setPlaybackError('Playback didn’t start. Press play inside the video, then try again.'); });
  }, [lesson.segments, index, resetTranslation, recordSignal]);
  const replaySection = useCallback(() => { recordSignal(segment, 'replay'); navigate(index); }, [recordSignal, segment, navigate, index]);
  const togglePlayback = useCallback(() => {
    if (isPlaying) { media.current?.pause(); setStatus('paused'); return; }
    if (mode === 'shadowing' && (status === 'your-turn' || status === 'complete' || status === 'ready' || media.current!.time() >= segment.end - 0.08)) { navigate(index); return; }
    if (mode === 'continuous' && status === 'complete') { navigate(0); return; }
    setPlaybackError(''); setStatus('listening');
    void media.current?.play().catch(() => { setStatus('paused'); setPlaybackError('Playback didn’t start. Try the play button inside the video.'); });
  }, [isPlaying, mode, status, segment.end, navigate, index]);
  const continuePractice = useCallback(() => {
    if (index === lesson.segments.length - 1) { media.current?.pause(); setStatus('complete'); setFinished(true); setCompleted(true); completeLesson(lesson); recordCompletion(); setPracticeCount(n => n + 1); return; }
    setPracticeCount(n => n + 1); navigate(index + 1);
  }, [index, lesson, navigate, recordCompletion]);

  function replayEvidence(evidence: QuizEvidence) {
    const evidenceSection = lesson.segments.find(s => s.id === evidence.segmentIds[0]);
    if (evidenceSection) recordSignal(evidenceSection, 'evidence-replay');
    if (replayResumeIndex.current === null) replayResumeIndex.current = index;
    setReplayRange(evidence);
    navigate(lesson.segments.findIndex(s => s.id === evidence.segmentIds[0]), true, true);
    playerColumn.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function returnToQuiz() {
    const resume = replayResumeIndex.current;
    setReplayRange(null); replayResumeIndex.current = null;
    media.current?.pause();
    if (resume !== null) navigate(resume, false);
    document.getElementById('lesson-quiz')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document.getElementById('lesson-quiz')?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!ready || !isPlaying) return;
    let frame = 0;
    const tick = () => {
      const adapter = media.current; if (!adapter) return;
      const time = adapter.time();
      if (seeking.current) {
        if (Math.abs(time - seeking.current.target) < 1.2 || Date.now() > seeking.current.deadline) seeking.current = null;
        else return;
      }
      if (replayRange) {
        if (time >= replayRange.end - 0.025) { adapter.pause(); setElapsed(replayRange.end); setStatus('paused'); return; }
        if (++frame % 5 === 0) setElapsed(time);
        return;
      }
      // Detect user seeking with the native controls as well as advancing playback.
      const match = lesson.segments.findIndex((s, n) => time >= s.start - 0.02 && time < (lesson.segments[n + 1]?.start ?? duration + 1));
      if (mode === 'shadowing') {
        // Check the armed section's boundary before considering the next section.
        if (time >= segment.end - 0.025 && time < segment.end + 1.25) {
          adapter.pause(); setElapsed(segment.end); setStatus('your-turn'); setPracticeCount(n => n + 1); return;
        }
        if (match >= 0 && match !== index) { setIndex(match); resetTranslation(); }
      } else if (match >= 0 && match !== index) { setIndex(match); resetTranslation(); }
      if (++frame % 5 === 0) setElapsed(time);
    };
    const interval = window.setInterval(tick, 35);
    // Avoid running past a section when a background tab throttles the timing loop.
    const visibility = () => { if (document.hidden && mode === 'shadowing') { media.current?.pause(); setStatus('paused'); } else tick(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { clearInterval(interval); document.removeEventListener('visibilitychange', visibility); };
  }, [ready, isPlaying, mode, index, segment.end, lesson.segments, duration, resetTranslation, replayRange]);

  const revealTranslation = useCallback(async () => {
    if (revealed) { setRevealed(false); setTranslationError(''); return; }
    recordSignal(segment, 'translation-reveal');
    setTranslationError('');
    if (translation) { setRevealed(true); return; }
    const controller = new AbortController(); translationAbort.current?.abort(); translationAbort.current = controller;
    setTranslating(true);
    try {
      const response = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          japanese: segment.japanese,
          previousJapanese: lesson.segments[index - 1]?.japanese,
          nextJapanese: lesson.segments[index + 1]?.japanese,
        }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      const data = await response.json();
      if (!response.ok || typeof data.translation !== 'string' || !data.translation.trim()) throw new Error(data.error || 'Translation is unavailable right now. Try again later.');
      if (!controller.signal.aborted) {
        setTranslations(current => ({ ...current, [segment.id]: data.translation }));
        setTranslationProvider(typeof data.provider === 'string' ? data.provider : '');
        setRevealed(true);
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setRevealed(false);
        setTranslationError(error instanceof Error && error.name !== 'TimeoutError' ? error.message : 'Translation took too long. Please try again.');
      }
    } finally { if (!controller.signal.aborted) setTranslating(false); }
  }, [revealed, translation, segment, recordSignal, lesson.segments, index]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || element.closest('input, textarea, select, audio, video, [contenteditable="true"], dialog') || ([' ', 'Enter'].includes(event.key) && element.closest('button,a')) || document.querySelector('dialog[open]') || !ready || recording || quizOpen) return;
      const actions: Record<string, () => void> = { ' ': togglePlayback, r: replaySection, R: replaySection, Enter: continuePractice, ArrowLeft: () => navigate(index - 1), ArrowRight: () => navigate(index + 1), t: () => void revealTranslation(), T: () => void revealTranslation() };
      const action = actions[event.key]; if (action) { event.preventDefault(); action(); }
    }
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [ready, recording, togglePlayback, navigate, index, continuePractice, revealTranslation, quizOpen, replaySection]);

  const onPlaying = useCallback((playing: boolean) => {
    setStatus(current => playing ? 'listening' : current === 'listening' ? 'paused' : current);
  }, []);
  const onReady = useCallback(() => { setReady(true); setPlaybackError(''); media.current?.setSpeed(speed); }, [speed]);
  const onEnded = useCallback(() => {
    if (replayRange) { setStatus('paused'); return; }
    setStatus(mode === 'shadowing' ? 'your-turn' : 'complete'); setElapsed(duration);
    if (mode === 'continuous') { setFinished(true); setCompleted(true); completeLesson(lesson); recordCompletion(); }
  }, [mode, duration, lesson, replayRange, recordCompletion]);
  const onMediaError = useCallback((message: string) => { setPlaybackError(message); setStatus('paused'); }, []);
  const pauseForRecording = useCallback(() => { media.current?.pause(); setStatus('your-turn'); }, []);
  function reattach(file: File | undefined) {
    if (!file) return;
    if (file.size > 250 * 1024 * 1024) { setPlaybackError('Choose a file smaller than 250 MB.'); return; }
    const mediaUrl = URL.createObjectURL(file);
    setLesson(current => ({ ...current, mediaUrl })); setReady(false);
  }
  const filtered = lesson.segments.map((s, n) => ({ segment: s, index: n })).filter(item => (!onlyFavorites || favorites.includes(item.segment.id)) && (!search || item.segment.japanese.includes(search.trim())));
  return <main className="practice-main" onClickCapture={progress.interact} onKeyDownCapture={event => { if (!event.repeat) progress.interact(); }}>
    {progress.warning ? <p className="small error-message" role="status">Progress for this visit may not be saved.</p> : null}
    <div className="practice-breadcrumb"><Link href="/"><ArrowLeft size={14} />Your practice</Link><span>/</span><span>{lesson.source === 'demo' ? 'Listening studio' : lesson.source === 'youtube' ? 'YouTube' : 'Your media'}</span><span className="private-label">One sentence at a time.</span></div>
    <div className="practice-title"><div><span className="eyebrow">{lesson.source === 'demo' ? 'A MOMENT FOR YOUR JAPANESE' : 'YOUR LISTENING SESSION'}</span><h1>{lesson.title}</h1><p>{lesson.author}<span>·</span>{lesson.segments.length} sections<span>·</span>{timestamp(duration)}</p></div><div className="practice-progress"><span>{index + 1}<span> / {lesson.segments.length}</span></span><div><i style={{ width: `${(index + 1) / lesson.segments.length * 100}%` }} /></div><span className="small muted">a little closer</span></div></div>
    <div className="practice-grid"><div className="player-column" ref={playerColumn}>
      <MediaPlayer ref={media} lesson={lesson} initialTime={lesson.segments[session.index].start} speed={speed} onReady={onReady} onPlaying={onPlaying} onEnded={onEnded} onError={onMediaError} />
      {replayRange ? <div className="evidence-banner" role="status"><span>Lesson evidence · {timestamp(replayRange.start)} – {timestamp(replayRange.end)}</span><button className="button" onClick={returnToQuiz}>Return to question<ArrowRight size={16} /></button></div> : null}
      {lesson.source === 'upload' && !lesson.mediaUrl ? <label className="reattach button"><Upload size={16} />Reattach {lesson.mediaName || 'your media'}<input aria-label="Reattach media" type="file" accept="audio/*,video/*" onChange={event => reattach(event.target.files?.[0])} /></label> : null}
      <div className="player-settings"><div className="segmented-control" aria-label="Playback mode"><button className={mode === 'shadowing' ? 'selected' : ''} aria-pressed={mode === 'shadowing'} onClick={() => setMode('shadowing')}><Mic size={14} />Shadowing</button><button className={mode === 'continuous' ? 'selected' : ''} aria-pressed={mode === 'continuous'} onClick={() => setMode('continuous')}><Headphones size={14} />Continuous</button></div><label className="speed-control">Speed<select aria-label="Playback speed" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option></select></label></div>
      <section className={`current-card state-${recording ? 'recording' : status}`} aria-labelledby="current-japanese">
        <div className="current-heading"><span className="state-badge" role="status" data-testid="playback-state">{recording ? <Mic size={13} /> : status === 'listening' ? <AudioLines size={14} /> : status === 'your-turn' ? <Mic size={13} /> : <span className="tiny-dot" />}{stateLabel}</span><span className="section-time">{timestamp(segment.start)} — {timestamp(segment.end)}</span></div>
        <h2 id="current-japanese" lang="ja" data-testid="current-japanese">{segment.japanese}</h2>
        <div className="translation-row"><button className="translation-button" aria-expanded={revealed} aria-controls="current-translation" disabled={translating} onClick={() => void revealTranslation()}><Languages size={16} />{translating ? 'Translating…' : revealed ? 'Hide translation' : 'Reveal translation'}<span>T</span></button><button className={`icon-button favorite-button ${isFavorite ? 'saved' : ''}`} aria-label={isFavorite ? 'Unsave this section' : 'Save this section for practice'} aria-pressed={isFavorite} onClick={() => { recordSignal(segment, 'bookmark'); setFavorites(current => isFavorite ? current.filter(id => id !== segment.id) : [...current, segment.id]); }}><Bookmark size={18} fill={isFavorite ? 'currentColor' : 'none'} /></button></div>
        {revealed ? <div id="current-translation" className="current-translation" lang="en"><>{translation}<span className="translation-source">{segment.translation ? 'Studio translation' : translationProvider ? `Automatic translation · ${translationProvider}` : 'Automatic translation'}</span></></div> : null}
        {translating ? <p className="small muted" role="status"><LoaderCircle className="spin" size={14} />Finding the meaning…</p> : null}
        {translationError ? <p className="small" role="alert">{translationError} <button className="text-button" onClick={() => { setTranslationError(''); void revealTranslation(); }}>Try again</button></p> : null}
        <div className="section-track" aria-label="Section playback progress"><span style={{ width: `${percent}%` }} /></div>
        <div className="practice-controls"><button className="icon-button previous-button" aria-label="Previous section" title="Previous section (←)" disabled={!ready || recording || index === 0} onClick={() => navigate(index - 1)}><ChevronLeft size={21} /></button><button className="button replay-button" disabled={!ready || recording} onClick={replaySection}><RotateCcw size={16} />Replay<span className="key-hint">R</span></button>
          {mode === 'continuous' ? <button className="button primary continue-button" disabled={!ready || recording} onClick={togglePlayback}>{isPlaying ? <><Pause size={16} />Pause</> : <><Play size={16} fill="currentColor" />Play</>}</button> : status === 'your-turn' || status === 'complete' ? <button className="button primary continue-button" disabled={!ready || recording} onClick={continuePractice}>{index === lesson.segments.length - 1 ? 'Finish practice' : 'Continue'}<ArrowRight size={17} /></button> : <button className="button primary continue-button" disabled={!ready || recording} onClick={togglePlayback}>{isPlaying ? <><Pause size={16} />Pause</> : <><Play size={15} fill="currentColor" />Listen</>}</button>}
          <button className="icon-button next-button" aria-label="Next section" title="Next section (→)" disabled={!ready || recording || index === lesson.segments.length - 1} onClick={() => navigate(index + 1)}><ChevronRight size={21} /></button></div>
        <p className="turn-instruction">{recording ? 'Let your voice find the rhythm.' : mode === 'continuous' ? 'The video plays through. Switch to shadowing for space to speak.' : status === 'your-turn' ? 'Say it in your own voice. Continue when you’re ready.' : status === 'listening' ? 'Take in the rhythm. We’ll pause so you can speak.' : 'Listen first. You’ll have all the time you need to repeat it.'}</p>
        {segment.estimated ? <p className="small muted estimated-note">This long caption was split at a clause; timings are approximate.</p> : null}
      </section>
      <VoiceRecorder key={segment.id} enabled={ready && !isPlaying} nativePlaying={isPlaying} onBeforeRecord={pauseForRecording} onRecording={setRecording} onAttempt={() => recordSignal(segment, 'recording-attempt')} />
      {finished ? <div className="completion-card" role="status"><span><Check size={20} /></span><div><strong>You made a little progress today.</strong><p>Every repetition helps the rhythm feel more familiar.</p></div><button className="text-button" onClick={() => navigate(0, false)}>Practice again<RotateCcw size={14} /></button></div> : null}
      {completed ? <ComprehensionQuiz lesson={lesson} ready={ready} recording={recording} replaying={!!replayRange} onReplay={replayEvidence} onReturn={returnToQuiz} onOpenChange={open => { setQuizOpen(open); if (!open && replayRange) returnToQuiz(); else if (open) { media.current?.pause(); setStatus('paused'); } }} /> : null}
      {playbackError ? <p role="alert" className="error-message">{playbackError}</p> : null}
      <LessonDifficulty lesson={lesson} onWaitingChange={setDifficultyWaiting} />
      <div className="player-footnote"><span>{lesson.source === 'demo' ? 'Studio sample · Japanese synthetic voice' : lesson.transcriptSource}</span><button className="text-button" onClick={onHelp}><Keyboard size={14} />Shortcuts</button></div>
      {!segment.translation ? <p className="translation-privacy">Revealing a translation sends this Japanese section plus up to one neighboring Japanese section on each side for context. It never includes your recordings, quiz results, or learner history.</p> : null}
    </div><aside className="transcript-card" aria-labelledby="transcript-title"><div className="transcript-heading"><div><span className="eyebrow">FOLLOW THE CONVERSATION</span><h2 id="transcript-title">Your transcript</h2></div><span className="transcript-count">{lesson.segments.length}</span></div><div className="transcript-tools"><label className="transcript-search"><Search size={15} /><input aria-label="Search Japanese transcript" placeholder="Find a phrase…" value={search} onChange={event => setSearch(event.target.value)} /></label><button className={`icon-button ${onlyFavorites ? 'saved' : ''}`} aria-label={onlyFavorites ? 'Show all sections' : 'Show saved sections'} aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites(!onlyFavorites)}><Bookmark size={16} fill={onlyFavorites ? 'currentColor' : 'none'} /></button></div><div className="transcript-scroll" ref={transcript} tabIndex={0} aria-label="Timestamped Japanese sections"><div>{filtered.map(item => <button key={item.segment.id} ref={item.index === index ? activeRow : undefined} data-testid={`transcript-${item.index}`} aria-current={item.index === index ? 'true' : undefined} className={`transcript-row ${item.index === index ? 'current' : item.index < index ? 'past' : ''}`} disabled={recording} onClick={() => navigate(item.index, ready)}><span className="row-number">{item.index === index ? <AudioLines size={16} /> : item.index < index ? <Check size={13} /> : String(item.index + 1).padStart(2, '0')}</span><span className="row-content"><span className="row-time">{timestamp(item.segment.start)}{favorites.includes(item.segment.id) ? <Bookmark size={11} fill="currentColor" /> : null}</span><span lang="ja">{item.segment.japanese}</span></span>{item.index === index ? <span className="active-dot" /> : null}</button>)}</div>{!filtered.length ? <p className="transcript-empty">{onlyFavorites ? 'Save a section with the bookmark beside its translation button.' : 'No phrases found. Try a shorter Japanese phrase.'}</p> : null}</div><div className="transcript-bottom"><span><span className="tiny-dot" />{mode === 'shadowing' ? 'A pause after every section' : 'Following your listening'}</span><span>{practiceCount ? `${practiceCount} repetitions` : 'Your own pace'}</span></div></aside></div>
    <div className="practice-signoff"><span lang="ja">焦らず、少しずつ。</span><span>No rush. Just a little closer.</span></div>
  </main>;
}
