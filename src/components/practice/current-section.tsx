'use client';
import { useState } from 'react';
import {
  Mic,
  AudioLines,
  Languages,
  Bookmark,
  LoaderCircle,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Pause,
  Play,
  ArrowRight,
} from 'lucide-react';
import type { Lesson, Mode, PlaybackState, Segment } from '@/lib/types';
import { timestamp } from '@/lib/youtube';
import { JapaneseText } from '../japanese-text';
import { DictionarySavePanel } from '../dictionary-save';
type CurrentSectionProps = {
  recording: boolean;
  status: PlaybackState;
  stateLabel: string;
  lesson: Lesson;
  segment: Segment;
  furigana: boolean;
  revealed: boolean;
  translating: boolean;
  revealTranslation: () => Promise<void>;
  isFavorite: boolean;
  toggleFavorite: () => void;
  translation: string | undefined;
  translationProvider: string;
  translationError: string;
  setTranslationError: (message: string) => void;
  percent: number;
  ready: boolean;
  index: number;
  navigate: (index: number, play?: boolean) => void;
  replaySection: () => void;
  mode: Mode;
  isPlaying: boolean;
  togglePlayback: () => void;
  continuePractice: () => void;
  lastIndex: number;
};
export function CurrentSection({
  recording,
  status,
  stateLabel,
  lesson,
  segment,
  furigana,
  revealed,
  translating,
  revealTranslation,
  isFavorite,
  toggleFavorite,
  translation,
  translationProvider,
  translationError,
  setTranslationError,
  percent,
  ready,
  index,
  navigate,
  replaySection,
  mode,
  isPlaying,
  togglePlayback,
  continuePractice,
  lastIndex,
}: CurrentSectionProps) {
  const [lookup, setLookup] = useState<{ segmentId: string; term: string } | null>(null);
  const lookupTerm = lookup?.segmentId === segment.id ? lookup.term : '';
  return (
    <section
      className={`current-card state-${recording ? 'recording' : status}`}
      aria-labelledby="current-japanese"
    >
      <div className="current-heading">
        <span className="state-badge" role="status" data-testid="playback-state">
          {recording ? (
            <Mic size={13} />
          ) : status === 'listening' ? (
            <AudioLines size={14} />
          ) : status === 'your-turn' ? (
            <Mic size={13} />
          ) : (
            <span className="tiny-dot" />
          )}
          {stateLabel}
        </span>
        <span className="section-time">
          {timestamp(segment.start)} — {timestamp(segment.end)}
        </span>
      </div>
      <h2
        id="current-japanese"
        lang="ja"
        aria-label={segment.japanese}
        data-testid="current-japanese"
      >
        <JapaneseText
          text={segment.japanese}
          furigana={furigana}
          onLookup={(term) => setLookup({ segmentId: segment.id, term })}
        />
      </h2>
      <p className="dictionary-lookup-hint">Click a word or select a phrase to save it.</p>
      {lookupTerm ? (
        <DictionarySavePanel
          key={`${segment.id}:${lookupTerm}`}
          term={lookupTerm}
          lesson={lesson}
          segment={segment}
          sourceTranslation={translation}
          onClose={() => setLookup(null)}
        />
      ) : null}
      <div className="translation-row">
        <button
          className="translation-button"
          aria-expanded={revealed}
          aria-controls="current-translation"
          disabled={translating}
          onClick={() => void revealTranslation()}
        >
          <Languages size={16} />
          {translating ? 'Translating…' : revealed ? 'Hide translation' : 'Reveal translation'}
          <span>T</span>
        </button>
        <button
          className={`icon-button favorite-button ${isFavorite ? 'saved' : ''}`}
          aria-label={isFavorite ? 'Unsave this section' : 'Save this section for practice'}
          aria-pressed={isFavorite}
          onClick={toggleFavorite}
        >
          <Bookmark size={18} fill={isFavorite ? 'currentColor' : 'none'} />
        </button>
      </div>
      {revealed ? (
        <div id="current-translation" className="current-translation" lang="en">
          <>
            {translation}
            <span className="translation-source">
              {segment.translation
                ? 'Studio translation'
                : translationProvider
                  ? `Automatic translation · ${translationProvider}`
                  : 'Automatic translation'}
            </span>
          </>
        </div>
      ) : null}
      {translating ? (
        <p className="small muted" role="status">
          <LoaderCircle className="spin" size={14} />
          Finding the meaning…
        </p>
      ) : null}
      {translationError ? (
        <p className="small" role="alert">
          {translationError}{' '}
          <button
            className="text-button"
            onClick={() => {
              setTranslationError('');
              void revealTranslation();
            }}
          >
            Try again
          </button>
        </p>
      ) : null}
      <div className="section-track" aria-label="Section playback progress">
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="practice-controls">
        <button
          className="icon-button previous-button"
          aria-label="Previous section"
          title="Previous section (←)"
          disabled={!ready || recording || index === 0}
          onClick={() => navigate(index - 1)}
        >
          <ChevronLeft size={21} />
        </button>
        <button
          className="button replay-button"
          disabled={!ready || recording}
          onClick={replaySection}
        >
          <RotateCcw size={16} />
          Replay<span className="key-hint">R</span>
        </button>
        {mode === 'continuous' ? (
          <button
            className="button primary continue-button"
            disabled={!ready || recording}
            onClick={togglePlayback}
          >
            {isPlaying ? (
              <>
                <Pause size={16} />
                Pause
              </>
            ) : (
              <>
                <Play size={16} fill="currentColor" />
                Play
              </>
            )}
          </button>
        ) : status === 'your-turn' || status === 'complete' ? (
          <button
            className="button primary continue-button"
            disabled={!ready || recording}
            onClick={continuePractice}
          >
            {index === lastIndex ? 'Finish practice' : 'Continue'}
            <ArrowRight size={17} />
          </button>
        ) : (
          <button
            className="button primary continue-button"
            disabled={!ready || recording}
            onClick={togglePlayback}
          >
            {isPlaying ? (
              <>
                <Pause size={16} />
                Pause
              </>
            ) : (
              <>
                <Play size={15} fill="currentColor" />
                Listen
              </>
            )}
          </button>
        )}
        <button
          className="icon-button next-button"
          aria-label="Next section"
          title="Next section (→)"
          disabled={!ready || recording || index === lastIndex}
          onClick={() => navigate(index + 1)}
        >
          <ChevronRight size={21} />
        </button>
      </div>
      <p className="turn-instruction">
        {recording
          ? 'Let your voice find the rhythm.'
          : mode === 'continuous'
            ? 'The video plays through. Switch to shadowing for space to speak.'
            : status === 'your-turn'
              ? 'Say it in your own voice. Continue when you’re ready.'
              : status === 'listening'
                ? 'Take in the rhythm. We’ll pause so you can speak.'
                : 'Listen first. You’ll have all the time you need to repeat it.'}
      </p>
      {segment.estimated ? (
        <p className="small muted estimated-note">
          This long caption was split at a clause; timings are approximate.
        </p>
      ) : null}
    </section>
  );
}
