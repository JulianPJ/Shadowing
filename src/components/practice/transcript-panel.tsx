'use client';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react';
import { Bookmark, Search, AudioLines, Play } from 'lucide-react';
import type { Lesson, Mode, Segment } from '@/lib/types';
import { timestamp } from '@/lib/youtube';
import { JapaneseText } from '../japanese-text';
import { DictionarySavePanel } from '../dictionary-save';
type TranscriptProps = {
  lesson: Lesson;
  index: number;
  favorites: string[];
  recording: boolean;
  ready: boolean;
  furigana: boolean;
  mode: Mode;
  practiceCount: number;
  navigate: (index: number, play?: boolean) => void;
  recommendedSegmentIds?: Set<string> | null;
  onClearRecommendations?: () => void;
  hidden?: boolean;
};
export const TranscriptPanel = memo(function TranscriptPanel({
  lesson,
  index,
  favorites,
  recording,
  ready,
  furigana,
  mode,
  practiceCount,
  navigate,
  recommendedSegmentIds,
  onClearRecommendations,
  hidden = false,
}: TranscriptProps) {
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLDivElement>(null);
  const [lookup, setLookup] = useState<{ segmentId: string; term: string } | null>(null);
  const savedIds = useMemo(() => new Set(favorites), [favorites]);
  // Rows are memoized; route their actions through stable callbacks.
  const navigateRef = useRef(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);
  const play = useCallback((target: number) => navigateRef.current(target, true), []);
  const openLookup = useCallback(
    (segmentId: string, term: string) => setLookup({ segmentId, term }),
    [],
  );
  const closeLookup = useCallback(() => setLookup(null), []);
  const filtered = useMemo(() => {
    const phrase = search.trim();
    return lesson.segments
      .map((s, n) => ({ segment: s, index: n }))
      .filter(
        (item) =>
          (!onlyFavorites || savedIds.has(item.segment.id)) &&
          (!recommendedSegmentIds || recommendedSegmentIds.has(item.segment.id)) &&
          (!search || item.segment.japanese.includes(phrase)),
      );
  }, [lesson.segments, onlyFavorites, savedIds, search, recommendedSegmentIds]);
  useEffect(() => {
    const row = activeRow.current;
    const container = transcript.current;
    if (row && container) {
      const top =
        row.getBoundingClientRect().top -
        container.getBoundingClientRect().top +
        container.scrollTop;
      if (
        top < container.scrollTop + 12 ||
        top + row.offsetHeight > container.scrollTop + container.clientHeight - 12
      )
        container.scrollTo({
          top: Math.max(0, top - container.clientHeight / 2 + row.offsetHeight / 2),
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
        });
    }
  }, [index, search, onlyFavorites, recommendedSegmentIds]);
  return (
    <aside
      id="practice-transcript"
      className="transcript-card"
      aria-labelledby="transcript-title"
      hidden={hidden}
    >
      <div className="transcript-heading">
        <div>
          <span className="eyebrow">FOLLOW THE CONVERSATION</span>
          <h2 id="transcript-title">Your transcript</h2>
        </div>
        <span className="transcript-count">{lesson.segments.length}</span>
      </div>
      <p className="transcript-lookup-hint">
        Play a line to listen. Choose a word or select a phrase to look it up.
      </p>
      <div className="transcript-tools">
        <label className="transcript-search">
          <Search size={15} />
          <input
            aria-label="Search Japanese transcript"
            placeholder="Find a phrase…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          className={`icon-button ${onlyFavorites ? 'saved' : ''}`}
          aria-label={onlyFavorites ? 'Show all sections' : 'Show saved sections'}
          aria-pressed={onlyFavorites}
          onClick={() => setOnlyFavorites(!onlyFavorites)}
        >
          <Bookmark size={16} fill={onlyFavorites ? 'currentColor' : 'none'} />
        </button>
      </div>
      {recommendedSegmentIds ? (
        <div className="transcript-recommendations small">
          <span>Good lines to learn · {recommendedSegmentIds.size} suitable sections</span>
          <button className="text-button" onClick={onClearRecommendations}>
            Show full transcript
          </button>
        </div>
      ) : null}
      <div
        className="transcript-scroll"
        ref={transcript}
        tabIndex={0}
        aria-label="Timestamped Japanese sections"
      >
        <div>
          {filtered.map((item) => (
            <TranscriptRow
              key={item.segment.id}
              ref={item.index === index ? activeRow : undefined}
              lesson={lesson}
              segment={item.segment}
              index={item.index}
              current={item.index === index}
              saved={savedIds.has(item.segment.id)}
              disabled={recording || !ready}
              furigana={furigana}
              lookupTerm={lookup?.segmentId === item.segment.id ? lookup.term : null}
              onPlay={play}
              onLookup={openLookup}
              onCloseLookup={closeLookup}
            />
          ))}
        </div>
        {!filtered.length ? (
          <p className="transcript-empty">
            {recommendedSegmentIds
              ? 'No recommended lines match these filters. Clear search or show the full transcript.'
              : onlyFavorites
                ? 'Save a section with the bookmark beside its translation button.'
                : 'No phrases found. Try a shorter Japanese phrase.'}
          </p>
        ) : null}
      </div>
      <div className="transcript-bottom">
        <span>
          <span className="tiny-dot" />
          {mode === 'shadowing' ? 'A pause after every section' : 'Following your listening'}
        </span>
        <span>{practiceCount ? `${practiceCount} repetitions` : 'Your own pace'}</span>
      </div>
    </aside>
  );
});

type TranscriptRowProps = {
  ref?: Ref<HTMLDivElement>;
  lesson: Lesson;
  segment: Segment;
  index: number;
  current: boolean;
  saved: boolean;
  disabled: boolean;
  furigana: boolean;
  lookupTerm: string | null;
  onPlay: (index: number) => void;
  onLookup: (segmentId: string, term: string) => void;
  onCloseLookup: () => void;
};
const TranscriptRow = memo(function TranscriptRow({
  ref,
  lesson,
  segment,
  index,
  current,
  saved,
  disabled,
  furigana,
  lookupTerm,
  onPlay,
  onLookup,
  onCloseLookup,
}: TranscriptRowProps) {
  return (
    <div
      ref={ref}
      aria-current={current ? 'true' : undefined}
      className={`transcript-row ${current ? 'current' : ''}`}
    >
      <button
        className="transcript-play"
        data-testid={`transcript-${index}`}
        aria-label={`Play section ${index + 1} at ${timestamp(segment.start)}`}
        disabled={disabled}
        onClick={() => onPlay(index)}
      >
        <span className="row-number" aria-hidden="true">
          {current ? <AudioLines size={16} /> : <Play size={15} />}
        </span>
        <span className="row-time">
          {timestamp(segment.start)}
          {saved ? <Bookmark size={11} fill="currentColor" /> : null}
        </span>
      </button>
      <div className="row-content">
        <span lang="ja">
          <JapaneseText
            text={segment.japanese}
            furigana={furigana}
            highlightWords
            analysisPriority="background"
            onLookup={(term) => onLookup(segment.id, term)}
          />
        </span>
        {lookupTerm !== null ? (
          <DictionarySavePanel
            key={`${segment.id}:${lookupTerm}`}
            term={lookupTerm}
            lesson={lesson}
            segment={segment}
            sourceTranslation={segment.translation}
            onClose={onCloseLookup}
          />
        ) : null}
      </div>
      {current ? <span className="active-dot" /> : null}
    </div>
  );
});
