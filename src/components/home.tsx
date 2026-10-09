'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  ArrowUpRight,
  Headphones,
  SquarePlay,
  Upload,
  Play,
  Check,
  LoaderCircle,
  X,
  Clock3,
} from 'lucide-react';
import { SectionTabs } from './chrome';
import { ImportDialog, type PageImport } from './import-dialog';
import { bridgeRequest } from '@/lib/extension/bridge';
import {
  japaneseTrack,
  lessonFromPageTrack,
  validatePendingImport,
} from '@/lib/extension/page-import';
import { pageMedia } from '@/lib/media';
import { prepareLinkedVideo } from '@/lib/prepare-client';
import { recordDiscoveryEvents } from '@/lib/discover/client';
import { saveLesson } from '@/lib/storage/lessons';
import type { Lesson, ResolvedMedia } from '@/lib/types';
import { ContinueRow } from './library-preview';
import { addQueueLink } from '@/lib/library/client';
import { useLibrary } from './use-library';
import { DiscoverFeed } from './discover/feed';
import { LibraryTab } from './my-library';

export type HomeTab = 'discover' | 'library';
export const discoverEnabled = process.env.NEXT_PUBLIC_DISCOVER_ENABLED !== 'false';

/** Home: start a lesson now, continue one, then browse Discover or your Library. */
export function Home({
  tab = discoverEnabled ? 'discover' : 'library',
  autoPrepare = false,
}: {
  tab?: HomeTab;
  autoPrepare?: boolean;
}) {
  const router = useRouter();
  const library = useLibrary();
  const { lessons, remote, ready } = library;
  const returning = ready && (lessons.length > 0 || remote.length > 0);
  const activeTab = discoverEnabled ? tab : 'library';
  const [url, setUrl] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importChoice, setImportChoice] = useState<'generate' | null>(null);
  const [page, setPage] = useState<PageImport | undefined>();
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
  /** A video handed over by Hibiki Bridge: its own Japanese subtitles start practice at once. */
  async function importFromBridge() {
    setError('');
    setBusy(true);
    setStage('identify');
    setMessage('Receiving the video from Hibiki Bridge…');
    try {
      const pending = validatePendingImport(await bridgeRequest('pending-import'));
      // A reload of this address should not ask the extension again.
      window.history.replaceState(null, '', '/');
      const track = japaneseTrack(pending.tracks);
      if (track) {
        setStage('segment');
        openLesson(await lessonFromPageTrack(pending, track));
        return;
      }
      setPage({
        tabId: pending.tabId,
        media: await pageMedia(pending.pageUrl),
        title: pending.title,
        duration: pending.duration,
      });
      setMessage('This video has no Japanese subtitles. Add your own or generate them.');
      setNeedsTranscript(true);
      setImportOpen(true);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'Hibiki Bridge could not hand over the video.',
      );
    } finally {
      setBusy(false);
    }
  }
  const startBridgeImport = useEffectEvent(() => void importFromBridge());
  const autoStart = useEffectEvent((queuedUrl: string, generate: boolean) => {
    setUrl(queuedUrl);
    if (generate && !autoPrepare) {
      // "Improve with Whisper": open the import with AI subtitles already chosen.
      setImportChoice('generate');
      setImportOpen(true);
    } else if (autoPrepare) void prepare(undefined, queuedUrl);
  });
  useEffect(() => {
    const params = new URL(window.location.href).searchParams;
    const queuedUrl = params.get('video');
    // Browser-only hand-offs (a queued link, or a video from Hibiki Bridge) start after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (params.get('bridge') === 'import' && !autoPrepare) startBridgeImport();
    else if (queuedUrl && queuedUrl.length <= 2000)
      autoStart(queuedUrl, params.get('subtitles') === 'generate');
    return () => {
      abort.current?.abort();
      abort.current = null;
    };
  }, [autoPrepare]);
  const stages = ['identify', 'captions', 'segment'];
  return (
    <main className={`home-main${returning ? ' returning-home' : ''}`}>
      {autoPrepare ? (
        <Link className="text-button" href="/">
          ← Back to Discover
        </Link>
      ) : null}
      <section className="hero" aria-labelledby="home-title">
        {returning ? (
          <h1 id="home-title" className="returning-home-title">
            Make a little room for Japanese.
          </h1>
        ) : (
          <div className="hero-intro">
            <span className="hero-tag">
              <span className="tiny-dot" /> A little Japanese. A little closer.
            </span>
            <h1 id="home-title">
              Find your rhythm.
              <br />
              <em>Make Japanese your own.</em>
            </h1>
            <p className="hero-description">
              Turn the videos you love into speaking practice. Listen to a little. Pause. Say it
              back.
            </p>
          </div>
        )}
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
              <Check size={14} /> YouTube captions load automatically. Other links work with your
              subtitles.
            </span>
            <button className="text-button" onClick={() => setImportOpen(true)}>
              <Upload size={14} /> Import media or subtitles
            </button>
          </div>
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
                      ? 'Saved to Watch Later.'
                      : 'Saved for this visit. Browser storage is unavailable.',
                  );
                } catch (error) {
                  setQueueNotice(
                    error instanceof Error ? error.message : 'This link could not be saved.',
                  );
                }
              }}
            >
              Watch later <ArrowRight size={14} />
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
      {returning ? (
        <ContinueRow library={library} />
      ) : (
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
              A gentle Japanese story about everyday life. Fourteen small moments to listen, repeat,
              and make your own.
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
          </div>
        </section>
      )}
      {autoPrepare ? null : (
        <>
          {discoverEnabled ? (
            <SectionTabs
              label="Browse"
              active={activeTab}
              tabs={[
                ['discover', 'Discover', '/discover'],
                ['library', 'Library', '/library'],
              ]}
            />
          ) : null}
          {activeTab === 'discover' ? (
            <DiscoverFeed library={library} />
          ) : (
            <LibraryTab library={library} />
          )}
        </>
      )}
      <ImportDialog
        key={
          importOpen
            ? `${url}:${resolved?.media.contentKey || page?.media.pageKey || ''}`
            : 'closed'
        }
        open={importOpen}
        initialUrl={url}
        initialResolved={resolved}
        transcriptUnavailable={needsTranscript}
        initialSubtitleChoice={importChoice}
        page={page}
        onClose={() => {
          setImportOpen(false);
          setImportChoice(null);
          setPage(undefined);
        }}
        onLesson={openLesson}
      />
    </main>
  );
}
