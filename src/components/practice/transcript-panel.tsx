'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Search, AudioLines, Play } from 'lucide-react';
import type { Lesson, Mode } from '@/lib/types';
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
            <div
              key={item.segment.id}
              ref={item.index === index ? activeRow : undefined}
              aria-current={item.index === index ? 'true' : undefined}
              className={`transcript-row ${item.index === index ? 'current' : ''}`}
            >
              <button
                className="transcript-play"
                data-testid={`transcript-${item.index}`}
                aria-label={`Play section ${item.index + 1} at ${timestamp(item.segment.start)}`}
                disabled={recording || !ready}
                onClick={() => navigate(item.index, true)}
              >
                <span className="row-number" aria-hidden="true">
                  {item.index === index ? <AudioLines size={16} /> : <Play size={15} />}
                </span>
                <span className="row-time">
                  {timestamp(item.segment.start)}
                  {savedIds.has(item.segment.id) ? (
                    <Bookmark size={11} fill="currentColor" />
                  ) : null}
                </span>
              </button>
              <div className="row-content">
                <span lang="ja">
                  <JapaneseText
                    text={item.segment.japanese}
                    furigana={furigana}
                    highlightWords
                    analysisPriority="background"
                    onLookup={(term) => setLookup({ segmentId: item.segment.id, term })}
                  />
                </span>
                {lookup?.segmentId === item.segment.id ? (
                  <DictionarySavePanel
                    key={`${item.segment.id}:${lookup.term}`}
                    term={lookup.term}
                    lesson={lesson}
                    segment={item.segment}
                    sourceTranslation={item.segment.translation}
                    onClose={() => setLookup(null)}
                  />
                ) : null}
              </div>
              {item.index === index ? <span className="active-dot" /> : null}
            </div>
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
