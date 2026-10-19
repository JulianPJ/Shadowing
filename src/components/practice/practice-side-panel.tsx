'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Captions,
  ChevronDown,
  Languages,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  SlidersHorizontal,
} from 'lucide-react';
import type { PracticePreset } from '@/lib/drill-presets';

const PRESET_LABELS: Record<PracticePreset, string> = {
  focus: 'Focus',
  support: 'Support',
  drill: 'Drill',
  continuous: 'Continuous',
};
// Wide screens open the panel beside the lesson, mid widths show its icon rail and narrow
// screens fold it above the player. Studio starts on the rail so the video keeps its width.
const SIDE_PANEL_QUERY = '(min-width: 1280px)';

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(SIDE_PANEL_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const wideSnapshot = () => window.matchMedia(SIDE_PANEL_QUERY).matches;
const serverWideSnapshot = () => false;

/**
 * Display toggles and practice settings in one panel. The children (practice settings) stay
 * mounted when the panel collapses, so drill state and focus survive the toggle.
 */
export function PracticeSidePanel({
  preset,
  speed,
  studioMode,
  setStudioMode,
  subtitleOverlay,
  setSubtitleOverlay,
  furigana,
  setFurigana,
  children,
}: {
  preset: PracticePreset;
  speed: number;
  studioMode: boolean;
  setStudioMode: (value: boolean) => void;
  subtitleOverlay: boolean;
  setSubtitleOverlay: (value: boolean) => void;
  furigana: boolean;
  setFurigana: (value: boolean) => void;
  children: ReactNode;
}) {
  // null follows the viewport (CSS mirrors this as data-state="auto") until the learner toggles.
  const [open, setOpen] = useState<boolean | null>(null);
  const wide = useSyncExternalStore(subscribeWide, wideSnapshot, serverWideSnapshot);
  const expanded = open ?? (wide && !studioMode);
  const state = open === null ? 'auto' : open ? 'open' : 'closed';
  const toggles = (
    <>
      <button
        className="side-panel-toggle"
        aria-pressed={studioMode}
        onClick={() => setStudioMode(!studioMode)}
        title="Studio Mode"
      >
        <PanelTop size={16} aria-hidden="true" />
        <span>Studio Mode</span>
      </button>
      {studioMode ? (
        <button
          className="side-panel-toggle"
          aria-pressed={subtitleOverlay}
          onClick={() => setSubtitleOverlay(!subtitleOverlay)}
          title="Subtitles on video"
        >
          <Captions size={16} aria-hidden="true" />
          <span>Subtitles on video</span>
        </button>
      ) : null}
      <button
        className="side-panel-toggle"
        aria-pressed={furigana}
        onClick={() => setFurigana(!furigana)}
        title="Furigana"
      >
        <Languages size={16} aria-hidden="true" />
        <span>Furigana</span>
      </button>
    </>
  );
  return (
    <aside className="practice-side-panel" data-state={state} aria-label="Practice options">
      <button
        className="side-panel-header"
        aria-expanded={expanded}
        aria-controls="practice-side-panel-body"
        onClick={() => setOpen(!expanded)}
      >
        <SlidersHorizontal size={15} aria-hidden="true" className="side-panel-mobile-icon" />
        <span className="side-panel-title">Options</span>
        <span className="side-panel-summary">
          {PRESET_LABELS[preset]} · {speed}×{furigana ? ' · Furigana' : ''}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="side-panel-chevron" />
        <PanelLeftClose size={16} aria-hidden="true" className="side-panel-collapse" />
        <PanelLeftOpen size={16} aria-hidden="true" className="side-panel-expand" />
      </button>
      <div className="side-panel-rail" aria-label="Practice display">
        {toggles}
      </div>
      <div id="practice-side-panel-body" className="side-panel-body">
        <section className="side-panel-section" aria-label="Practice display">
          <h2>Display</h2>
          <div className="side-panel-toggles">{toggles}</div>
        </section>
        <section className="side-panel-section">
          <h2>Practice</h2>
          {children}
        </section>
      </div>
    </aside>
  );
}
