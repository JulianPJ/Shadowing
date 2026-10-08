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
  Keyboard,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { AccountEntry } from './account';
import { ThemeToggle } from './theme-toggle';
import { ReviewLink } from './review-link';
import { useTaskReturn } from './task-return';

export function Header({ onHelp, player = false }: { onHelp: () => void; player?: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useTaskReturn();
  useEffect(() => {
    if (menuOpen) menu.current?.showModal();
    else menu.current?.close();
  }, [menuOpen]);
  function closeMenu() {
    setMenuOpen(false);
    menu.current?.close();
    trigger.current?.focus();
  }
  function navigation(mobile = false) {
    return (
      <>
        <Link className="nav-link" href="/library">
          Library
        </Link>
        <Link className="nav-link" href="/dictionary">
          Vocabulary
        </Link>
        <ReviewLink />
        <Link className="nav-link" href="/progress">
          Progress
        </Link>
        <AccountEntry drawer={!mobile} />
        <button
          className="nav-link"
          onClick={() => {
            closeMenu();
            onHelp();
          }}
        >
          {player ? (
            <>
              <Keyboard size={16} /> Shortcuts
            </>
          ) : (
            'How it works'
          )}
        </button>
        <ThemeToggle />
        <Link className="nav-demo" href={player ? '/' : '/practice/demo'}>
          {player ? 'New practice' : 'Try a practice'}
          <ArrowUpRight size={15} />
        </Link>
      </>
    );
  }
  return (
    <header className={`site-header ${player ? 'practice-header' : ''}`}>
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
          {navigation()}
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
          {navigation(true)}
        </nav>
      </dialog>
    </header>
  );
}
export function StandaloneNavigation({
  vocabularyView,
}: {
  vocabularyView?: 'saved' | 'decks' | 'review' | 'knowledge';
}) {
  const [help, setHelp] = useState(false);
  const { practice } = useTaskReturn();
  return (
    <>
      <Header onHelp={() => setHelp(true)} />
      <div className="standalone-navigation">
        <Link className="task-return" href={practice}>
          <ArrowLeft size={18} />
          {practice.startsWith('/practice/') ? 'Back to practice' : 'Home'}
        </Link>
        {vocabularyView ? (
          <nav className="vocabulary-navigation" aria-label="Vocabulary views">
            {(
              [
                ['saved', 'Saved words', '/dictionary'],
                ['decks', 'Decks', '/dictionary?view=decks'],
                ['review', 'Review', '/review'],
                ['knowledge', 'Word knowledge', '/words'],
              ] as const
            ).map(([view, label, href]) => (
              <Link
                key={view}
                href={href}
                aria-current={view === vocabularyView ? 'page' : undefined}
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}
export function Footer() {
  return (
    <footer className="site-footer">
      <span>Made for a little progress, every day.</span>
      <span lang="ja">聞く。まねる。身につく。</span>
    </footer>
  );
}
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
        <div className="shortcut-grid">
          {[
            ['Space', 'Play / pause'],
            ['R', 'Replay section'],
            ['Enter', 'Continue'],
            ['← / →', 'Previous / next'],
            ['T', 'Translation'],
          ].map(([key, label]) => (
            <div key={key}>
              <kbd>{key}</kbd>
              <span>{label}</span>
            </div>
          ))}
        </div>
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
