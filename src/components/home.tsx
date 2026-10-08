'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  Headphones,
  Mic,
  Repeat2,
  SquarePlay,
  Upload,
  Play,
  Check,
  LoaderCircle,
  X,
  Clock3,
} from 'lucide-react';
import { Header, Footer, HelpDialog } from './chrome';
import { ImportDialog } from './import-dialog';
import { prepareLinkedVideo } from '@/lib/prepare-client';
import { recordDiscoveryEvents } from '@/lib/discover/client';
import { saveLesson } from '@/lib/storage';
import type { Lesson, ResolvedMedia } from '@/lib/types';
import { LibraryPreview } from './library-preview';
import { addQueueLink } from '@/lib/library/client';
import { useLibrary } from './use-library';

export function Home({ autoPrepare = false }: { autoPrepare?: boolean }) {
  const router = useRouter();
  const { lessons, remote, ready } = useLibrary();
  const returning = ready && (lessons.length > 0 || remote.length > 0);
  const [url, setUrl] = useState('');
  const [help, setHelp] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [error, setError] = useState('');
  const [resolved, setResolved] = useState<ResolvedMedia | undefined>();
  const [needsTranscript, setNeedsTranscript] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState('identify');
  const [message, setMessage] = useState('Finding your video…');
  const [queueNotice, setQueueNotice] = useState('');
  const abort = useRef<AbortController | null>(null);
  function openLesson(lesson: Lesson) {
    saveLesson(lesson, 0);
    if (autoPrepare && lesson.videoId)
      void recordDiscoveryEvents([{ videoId: lesson.videoId, action: 'prepared' }]);
    const destination = `/practice/${encodeURIComponent(lesson.id)}`;
    if (autoPrepare) router.replace(destination);
    else router.push(destination);
  }
  async function prepare(event?: React.FormEvent, input = url) {
    event?.preventDefault();
    if ((abort.current && !abort.current.signal.aborted) || !input.trim()) return;
    setError('');
    setResolved(undefined);
    setNeedsTranscript(false);
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setStage('identify');
    setMessage('Finding your video…');
    try {
      const result = await prepareLinkedVideo(
        input,
        controller.signal,
        (nextStage, nextMessage, selected) => {
          if (controller.signal.aborted) return;
          setStage(nextStage);
          setMessage(nextMessage);
          if (selected) setResolved(selected);
        },
      );
      if (controller.signal.aborted) return;
      if (result.needsTranscript) {
        setResolved(result.resolved);
        setNeedsTranscript(true);
        setMessage(result.needsTranscript);
        setImportOpen(true);
      } else if (result.lesson) openLesson(result.lesson);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error && error.name !== 'TimeoutError'
            ? error.message
            : 'The connection took too long. Try again, import subtitles, or use the demo.',
        );
    } finally {
      if (abort.current === controller) {
        abort.current = null;
        setBusy(false);
      }
    }
  }
  const autoStart = useEffectEvent((queuedUrl: string) => {
    setUrl(queuedUrl);
    if (autoPrepare) void prepare(undefined, queuedUrl);
  });
  useEffect(() => {
    const queuedUrl = new URL(window.location.href).searchParams.get('video');
    if (queuedUrl && queuedUrl.length <= 2000) {
      // An explicitly opened preparation route starts its browser-only URL hand-off after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      autoStart(queuedUrl);
    }
    return () => {
      abort.current?.abort();
      abort.current = null;
    };
  }, [autoPrepare]);
  const stages = ['identify', 'captions', 'segment'];
  return (
    <>
      <Header onHelp={() => setHelp(true)} />
      <main className={`home-main${returning ? ' returning-home' : ''}`}>
        {autoPrepare ? (
          <Link className="text-button" href="/discover">
            ← Back to Discover
          </Link>
        ) : null}
        {returning ? (
          <h1 className="returning-home-title">Make a little room for Japanese.</h1>
        ) : null}
        {returning ? <LibraryPreview /> : null}
        <section className="hero">
          <div className="hero-intro">
            <span className="hero-tag">
              <span className="tiny-dot" /> A little Japanese. A little closer.
            </span>
            <h1>
              Find your rhythm.
              <br />
              <em>Make Japanese your own.</em>
            </h1>
            <p className="hero-description">
              Turn the videos you love into speaking practice.
              <br className="desktop-break" /> Listen to a little. Pause. Say it back. Find your
              voice.
            </p>
          </div>
          <div className="start-card">
            <form onSubmit={prepare}>
              <label className="input-label" htmlFor="video-url">
                Paste a Japanese video link
              </label>
              <div className="url-input-wrap">
                <SquarePlay className="youtube-icon" size={23} strokeWidth={1.6} />
                <input
                  id="video-url"
                  aria-describedby="url-hint"
                  type="text"
                  inputMode="url"
                  value={url}
                  onChange={(event) => {
                    setUrl(event.target.value);
                    setResolved(undefined);
                    setNeedsTranscript(false);
                  }}
                  placeholder="https://..."
                  disabled={busy}
                  required
                  maxLength={2000}
                />
                <button className="button primary start-button" type="submit" disabled={busy}>
                  {busy ? (
                    <LoaderCircle className="spin" size={17} />
                  ) : (
                    <>
                      Start shadowing
                      <ArrowRight size={18} />
                    </>
                  )}
                </button>
              </div>
            </form>
            <div className="input-meta">
              <span id="url-hint">
                <Check size={14} /> YouTube captions prepare automatically when available.
              </span>
              <button className="text-button" onClick={() => setImportOpen(true)}>
                <Upload size={14} /> Import media or subtitles
              </button>
            </div>
            <p className="source-guidance">
              Vimeo and direct audio/video links work with your subtitles. Import your own media or
              transcript below. No account needed to practise.
            </p>
            {busy ? (
              <div className="preparing" role="status">
                <div className="prepare-top">
                  <span>
                    <LoaderCircle className="spin" size={15} />
                    {message}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Cancel preparation"
                    onClick={() => {
                      abort.current?.abort();
                      setBusy(false);
                    }}
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="prepare-stages">
                  {['Find video', 'Read Japanese', 'Shape your practice'].map((label, index) => (
                    <span className={stages.indexOf(stage) >= index ? 'active' : ''} key={label}>
                      <span>{stages.indexOf(stage) > index ? <Check size={11} /> : index + 1}</span>
                      {label}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {!busy && url.trim() ? (
              <button
                className="text-button queue-current-link"
                type="button"
                onClick={() => {
                  try {
                    const saved = addQueueLink(url, 'Queued video');
                    setQueueNotice(
                      saved
                        ? 'Saved to your queue.'
                        : 'Queued for this visit. Browser storage is unavailable.',
                    );
                  } catch (error) {
                    setQueueNotice(
                      error instanceof Error ? error.message : 'This link could not be queued.',
                    );
                  }
                }}
              >
                Queue for later <ArrowRight size={14} />
              </button>
            ) : null}
            {queueNotice ? (
              <p className="small muted" role="status">
                {queueNotice}
              </p>
            ) : null}
            {needsTranscript ? (
              <div role="status" className="error-message">
                <p>{message}</p>
                <button className="text-button" onClick={() => setImportOpen(true)}>
                  Upload your own transcript <ArrowRight size={14} />
                </button>
              </div>
            ) : null}
            {error ? (
              <div role="alert" className="error-message">
                <p>{error}</p>
                <div>
                  <button className="text-button" onClick={() => void prepare()}>
                    Retry preparation <ArrowRight size={14} />
                  </button>
                  <button className="text-button" onClick={() => setImportOpen(true)}>
                    Import a transcript <ArrowRight size={14} />
                  </button>
                  <Link className="text-button" href="/practice/demo">
                    Try the demo <ArrowRight size={14} />
                  </Link>
                </div>
              </div>
            ) : null}
          </div>
        </section>
        {!returning ? <LibraryPreview /> : null}
        <section className="demo-section" aria-labelledby="demo-title">
          <div className="demo-art">
            <Image
              src="/demo-poster.svg"
              alt="An illustrated Japanese mountain landscape at sunrise"
              fill
              sizes="(max-width: 700px) 100vw, 470px"
              priority
            />
            <Link href="/practice/demo" className="demo-art-play" aria-label="Play the demo lesson">
              <Play size={24} fill="currentColor" />
            </Link>
            <span className="art-label">THE LISTENING STUDIO</span>
          </div>
          <div className="demo-copy">
            <span className="eyebrow">
              <span className="tiny-dot" /> START SOMEWHERE SIMPLE
            </span>
            <h2 id="demo-title">
              A quiet morning.
              <br />
              Your first conversation.
            </h2>
            <p>
              Ease into the rhythm with a gentle Japanese story about everyday life. Fourteen small
              moments to listen, repeat, and make your own.
            </p>
            <div className="lesson-tags">
              <span>
                <Headphones size={14} /> Beginner friendly
              </span>
              <span>
                <Clock3 size={14} /> About 1 minute
              </span>
              <span>14 sections</span>
            </div>
            <Link className="button demo-button" href="/practice/demo">
              Try the demo
              <ArrowUpRight size={18} />
            </Link>
            <span className="demo-note">Built-in sample · Japanese synthetic voice · no setup</span>
          </div>
        </section>
        <section className="rhythm-section">
          <div className="section-heading">
            <span className="eyebrow">LESS RUSH. MORE RHYTHM.</span>
            <span className="small muted">A practice that leaves room for you.</span>
          </div>
          <div className="rhythm-grid">
            <div>
              <span className="step-icon">
                <Headphones size={23} />
              </span>
              <span className="step-number">01</span>
              <h3>Listen to a little.</h3>
              <p>Short, natural sections help you hear the details. Slow it down if you need to.</p>
            </div>
            <div>
              <span className="step-icon">
                <Mic size={23} />
              </span>
              <span className="step-number">02</span>
              <h3>Take your space.</h3>
              <p>Playback pauses for you. Say it aloud, record your voice, or simply try again.</p>
            </div>
            <div>
              <span className="step-icon">
                <Repeat2 size={23} />
              </span>
              <span className="step-number">03</span>
              <h3>Let it become yours.</h3>
              <p>
                Replay the rhythm. Reveal a translation when you need one. Move at your own pace.
              </p>
            </div>
          </div>
        </section>
        <div className="home-signoff">
          <span lang="ja">少しずつ、自分の声に。</span>
          <p>Little by little, in your own voice.</p>
        </div>
      </main>
      <Footer />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
      <ImportDialog
        key={importOpen ? `${url}:${resolved?.media.contentKey || ''}` : 'closed'}
        open={importOpen}
        initialUrl={url}
        initialResolved={resolved}
        transcriptUnavailable={needsTranscript}
        onClose={() => setImportOpen(false)}
        onLesson={openLesson}
      />
    </>
  );
}
