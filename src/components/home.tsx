'use client';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Compass,
  Headphones,
  Library,
  Play,
  Clock3,
  BookOpenText,
} from 'lucide-react';
import { ContinueRow } from './library-preview';
import { useLibrary } from './use-library';
import { DiscoverFeed } from './discover/feed';
import { LibraryTab } from './my-library';
import { AddVideoButton, VideoStart } from './video-start';
import { useAccount } from './account';
import { useReview } from './use-review';
import { dueReviews } from '@/lib/review-scheduler';
import { discoverEnabled } from '@/lib/discover/enabled';

/** Home: pick up where you left off, or start something new. Feeds live on Discover and Library. */
export function Home() {
  const library = useLibrary();
  const { lessons, remote, ready } = library;
  const returning = ready && (lessons.length > 0 || remote.length > 0);
  return (
    <main className={`home-main${returning ? ' returning-home' : ''}`}>
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
        <VideoStart />
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
      <HomeDestinations />
    </main>
  );
}

/** Small pointers to the destinations that own each task, rather than their full feeds. */
function HomeDestinations() {
  const account = useAccount();
  const { data } = useReview();
  const due = account.user ? dueReviews(data.cards, new Date().toISOString()).length : 0;
  return (
    <nav className="home-destinations" aria-label="More in Hibiki">
      {discoverEnabled ? (
        <Link className="home-destination" href="/discover">
          <Compass size={20} />
          <span>
            <strong>Discover</strong>
            <span>Find Japanese videos at your level</span>
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
      {due ? (
        <Link className="home-destination" href="/review">
          <BookOpenText size={20} />
          <span>
            <strong>
              {due} {due === 1 ? 'word' : 'words'} due
            </strong>
            <span>Review in Vocabulary</span>
          </span>
          <ArrowRight size={16} />
        </Link>
      ) : null}
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
