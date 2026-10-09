'use client';
import Link from 'next/link';
import {
  AudioLines,
  ArrowUpRight,
  ArrowLeft,
  Menu,
  X,
  Headphones,
  Mic,
  Repeat2,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ThemeToggle } from './theme-toggle';
import { useAccount } from './account';
import { useReview } from './use-review';
import { dueReviews } from '@/lib/review-scheduler';
import { authPath } from '@/lib/auth/return-path';
import { useTaskReturn } from './task-return';

/** Three sections: Home (practice, Discover, Library), Vocabulary and Profile. */
const sections = [
  { label: 'Home', href: '/', paths: ['/', '/discover', '/library', '/prepare'] },
  { label: 'Vocabulary', href: '/review', paths: ['/review', '/words', '/dictionary'] },
  { label: 'Profile', href: '/profile', paths: ['/profile', '/progress', '/account'] },
] as const;

function DueCount() {
  const account = useAccount();
  const { data } = useReview();
  const count = account.user ? dueReviews(data.cards, new Date().toISOString()).length : 0;
  return count ? (
    <span className="nav-badge" aria-label={`${count} due`}>
      {count}
    </span>
  ) : null;
}

/** Rendered once by the root layout so navigation keeps its state across routes. */
export function Header() {
  const pathname = usePathname() ?? '/';
  const account = useAccount();
  const { destination } = useTaskReturn();
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (menuOpen) menu.current?.showModal();
    else menu.current?.close();
  }, [menuOpen]);
  useEffect(() => {
    // Client navigation closes the mobile menu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false);
  }, [pathname]);
  function closeMenu() {
    setMenuOpen(false);
    menu.current?.close();
    trigger.current?.focus();
  }
  const links = (
    <>
      {sections.map((section) => (
        <Link
          key={section.href}
          className="nav-link"
          href={section.href}
          aria-current={
            (section.paths as readonly string[]).some(
              (path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)),
            )
              ? 'page'
              : undefined
          }
        >
          {section.label}
          {section.label === 'Vocabulary' ? <DueCount /> : null}
        </Link>
      ))}
      {account.loaded && !account.user ? (
        <Link className="nav-link" href={authPath('/sign-in', destination)}>
          Sign in
        </Link>
      ) : null}
      <ThemeToggle />
    </>
  );
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Hibiki home">
          <span className="brand-mark">
            <AudioLines size={22} strokeWidth={1.6} />
          </span>
          <span>
            hibiki
            <span className="brand-japanese" lang="ja">
              響
            </span>
          </span>
        </Link>
        <nav className="desktop-navigation" aria-label="Main navigation">
          {links}
        </nav>
        <button
          ref={trigger}
          className="button navigation-toggle"
          aria-label="Open navigation menu"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          onClick={() => setMenuOpen(true)}
        >
          <Menu size={19} /> Menu
        </button>
      </div>
      <dialog
        ref={menu}
        id="mobile-navigation"
        className="navigation-dialog"
        aria-labelledby="navigation-title"
        onCancel={closeMenu}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeMenu();
        }}
      >
        <div className="navigation-heading">
          <h2 id="navigation-title">Navigate Hibiki</h2>
          <button className="icon-button" aria-label="Close navigation menu" onClick={closeMenu}>
            <X size={20} />
          </button>
        </div>
        <nav
          aria-label="Mobile navigation"
          onClick={(event) => {
            if ((event.target as Element).closest('a')) closeMenu();
          }}
        >
          {links}
        </nav>
      </dialog>
    </header>
  );
}

/** Sub-navigation inside a section, e.g. Discover/Library or Review/Words. */
export function SectionTabs({
  label,
  tabs,
  active,
}: {
  label: string;
  tabs: readonly (readonly [key: string, title: React.ReactNode, href: string])[];
  active: string;
}) {
  return (
    <nav className="section-tabs" aria-label={label}>
      {tabs.map(([key, title, href]) => (
        <Link key={key} href={href} aria-current={key === active ? 'page' : undefined}>
          {title}
        </Link>
      ))}
    </nav>
  );
}

/** Returns to the paused lesson after a detour into Vocabulary or Profile. */
export function TaskReturn() {
  const { practice } = useTaskReturn();
  return practice.startsWith('/practice/') ? (
    <Link className="task-return" href={practice}>
      <ArrowLeft size={18} />
      Back to practice
    </Link>
  ) : null;
}

export function Footer() {
  return (
    <footer className="site-footer">
      <span>Made for a little progress, every day.</span>
      <span lang="ja">聞く。まねる。身につく。</span>
    </footer>
  );
}

const shortcuts = [
  ['Space', 'Play / pause'],
  ['R', 'Replay section'],
  ['Enter', 'Continue'],
  ['← / →', 'Previous / next'],
  ['T', 'Translation'],
  ['M', 'Record / stop'],
  ['P', 'Play your recording'],
] as const;

export function HelpDialog({
  open,
  onClose,
  player = false,
}: {
  open: boolean;
  onClose: () => void;
  player?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) ref.current?.showModal();
    else ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="help-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="help-title"
    >
      <button className="icon-button dialog-close" aria-label="Close help" onClick={onClose}>
        <X size={20} />
      </button>
      <span className="eyebrow">A SMALL DAILY PRACTICE</span>
      <h2 id="help-title">Listen. Pause. Make it yours.</h2>
      <p>
        Shadowing means repeating Japanese just after you hear it. Take one sentence at a time.
        Match the rhythm, then try again.
      </p>
      <div className="help-steps">
        <div>
          <Headphones />
          <strong>Listen closely</strong>
          <span>Hear a short section at your own pace.</span>
        </div>
        <div>
          <Mic />
          <strong>Take your turn</strong>
          <span>The source pauses. Repeat the Japanese aloud.</span>
        </div>
        <div>
          <Repeat2 />
          <strong>Make it stick</strong>
          <span>Replay, compare, and continue when you’re ready.</span>
        </div>
      </div>
      {player ? (
        <>
          <div className="shortcut-grid">
            {shortcuts.map(([key, label]) => (
              <div key={key}>
                <kbd>{key}</kbd>
                <span>{label}</span>
              </div>
            ))}
          </div>
          <p className="small muted">
            Revealing a translation sends that Japanese section and its neighbours to the
            translation service. Recordings never leave your device unless you ask for analysis.
          </p>
        </>
      ) : (
        <p className="small muted">
          Start with the built-in sample, paste a YouTube link, or import your own media and
          subtitles. No account needed.
        </p>
      )}
      <button className="button primary full-width" onClick={onClose}>
        Got it <ArrowUpRight size={17} />
      </button>
    </dialog>
  );
}
