'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  Clock3,
  Compass,
  Headphones,
  Library,
  Link2,
  Play,
} from 'lucide-react';
import { ResumeFeature } from './library-preview';
import { useLibrary } from './use-library';
import { DiscoverFeed } from './discover/feed';
import { LibraryTab } from './my-library';
import { AddVideoButton, VideoStart } from './video-start';
import { useReview } from './use-review';
import { useProAccess } from './pro-feature';
import { dueReviews } from '@/lib/review-scheduler';
import { discoverEnabled } from '@/lib/discover/enabled';

/**
 * Home answers "what can I pick up now?". First use leads with the demo so a visitor without a
 * link hears Japanese in one action; returning learners get one lesson to resume, a review entry
 * and their own-video form. Feeds live on Discover and Library.
 */
export function Home() {
  const library = useLibrary();
  const { lessons, remote, ready } = library;
  const returning = ready && (lessons.length > 0 || remote.length > 0);
  // One flat list of regions with fixed slots: VideoStart keeps its position (and its in-flight
  // Bridge or queued-link hand-off) when history hydrates and Home switches to the returning view.
  return (
    <main className={`home-main ${returning ? 'returning-home' : 'first-use-home'}`}>
      {returning ? (
        <header className="home-greeting">
          <div>
            <h1 id="home-title" className="returning-home-title">
              Make a little room for Japanese.
            </h1>
            <p>Pick up where you left off.</p>
          </div>
          <Link className="text-button" href="/library">
            Open Library <ArrowRight size={14} />
          </Link>
        </header>
      ) : (
        <section className="first-use-hero" aria-labelledby="home-title">
          <div className="first-use-copy">
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
            <div className="first-use-actions">
              <Link className="button primary" href="/practice/demo">
                <Play size={17} fill="currentColor" /> Try the demo
              </Link>
              <button
                className="button"
                type="button"
                onClick={() => {
                  const input = document.getElementById('video-url');
                  input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
                  input?.focus({ preventScroll: true });
                }}
              >
                Use my own video
              </button>
            </div>
            <p className="first-use-note">
              <Clock3 size={14} /> About a minute. No link or account needed.
            </p>
          </div>
          <div className="demo-art">
            <Image
              src="/demo-poster.svg"
              alt="An illustrated Japanese mountain landscape at sunrise"
              fill
              sizes="(max-width: 700px) 100vw, 520px"
              priority
            />
            <Link href="/practice/demo" className="demo-art-play" aria-label="Play the demo lesson">
              <Play size={24} fill="currentColor" />
            </Link>
            <span className="demo-art-caption">
              <strong>A quiet morning</strong>
              <span>
                <Headphones size={14} /> Beginner friendly · 14 sections
              </span>
            </span>
          </div>
        </section>
      )}
      {returning ? <ResumeFeature library={library} /> : null}
      {returning ? <ReviewCard /> : null}
      <section className="home-card home-own-video" aria-labelledby="own-video-title">
        <h2 id="own-video-title">
          <Link2 size={20} /> Bring your own video
        </h2>
        {returning ? null : (
          <p className="muted">
            Paste a YouTube link with Japanese captions, or import your own media and subtitles.
          </p>
        )}
        <VideoStart />
      </section>
      <HomeDestinations />
    </main>
  );
}

/** Vocabulary review at a glance, for Pro accounts; zero due is "up to date", not urgency. */
function ReviewCard() {
  const { isPro } = useProAccess('review');
  const { data } = useReview();
  if (!isPro) return null;
  const due = dueReviews(data.cards, new Date().toISOString()).length;
  return (
    <section className="home-card home-review" aria-labelledby="review-title">
      <h2 id="review-title">
        <BookOpenText size={20} /> Vocabulary review
      </h2>
      <p>{due ? `${due} ${due === 1 ? 'word' : 'words'} due today.` : 'You’re up to date.'}</p>
      <Link className="button" href={due ? '/review' : '/words'}>
        {due ? 'Review words' : 'Open words'} <ArrowRight size={16} />
      </Link>
      <Link className="text-button" href="/profile">
        See your week <ArrowRight size={14} />
      </Link>
    </section>
  );
}

/** Small pointers to the destinations that own each task, rather than their full feeds. */
function HomeDestinations() {
  return (
    <nav className="home-destinations" aria-label="More in Hibiki">
      {discoverEnabled ? (
        <Link className="home-destination" href="/discover">
          <Compass size={20} />
          <span>
            <strong>Discover</strong>
            <span>Find your next Japanese video</span>
          </span>
          <ArrowRight size={16} />
        </Link>
      ) : null}
      <Link className="home-destination" href="/library">
        <Library size={20} />
        <span>
          <strong>Library</strong>
          <span>Your lessons and Watch later</span>
        </span>
        <ArrowRight size={16} />
      </Link>
    </nav>
  );
}

function DestinationHeading({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <header className="destination-heading">
      <div>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
      {action}
    </header>
  );
}

/** Discover: the catalogue, search and JLPT-band browsing. */
export function DiscoverPage() {
  const library = useLibrary();
  if (!discoverEnabled) return <LibraryPage />;
  return (
    <main className="home-main destination-page">
      <DestinationHeading title="Discover">
        Japanese videos to watch next. Save one for later, or choose it to prepare for practice.
      </DestinationHeading>
      <DiscoverFeed library={library} />
    </main>
  );
}

/** Library: lessons you have practised or kept, and the Watch later queue. */
export function LibraryPage() {
  const library = useLibrary();
  return (
    <main className="home-main destination-page">
      <DestinationHeading title="Library" action={<AddVideoButton />}>
        Lessons you have started or saved, and videos waiting in Watch later.
      </DestinationHeading>
      <LibraryTab library={library} />
    </main>
  );
}

const origins = {
  discover: ['/discover', 'Back to Discover'],
  library: ['/library', 'Back to Library'],
  home: ['/', 'Back to Home'],
} as const;

/** /prepare: a focused preparation step that returns to wherever it was started from. */
export function PreparePage() {
  const [origin, setOrigin] = useState<keyof typeof origins>('home');
  useEffect(() => {
    const from = new URL(window.location.href).searchParams.get('from');
    // The origin is only known in the browser; direct entry keeps the Home default.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (from === 'discover' || from === 'library') setOrigin(from);
  }, []);
  const [href, label] = origins[origin];
  return (
    <main className="home-main prepare-page">
      <Link className="task-return" href={href}>
        <ArrowLeft size={18} />
        {label}
      </Link>
      <section className="hero" aria-labelledby="prepare-title">
        <h1 id="prepare-title" className="returning-home-title">
          Prepare a video
        </h1>
        <VideoStart autoPrepare />
      </section>
    </main>
  );
}
