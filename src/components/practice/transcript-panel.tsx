'use client';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Bookmark, Search, AudioLines } from 'lucide-react';
import type { Lesson, Mode } from '@/lib/types';
import { timestamp } from '@/lib/youtube';
import { JapaneseText } from '../japanese-text';
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
}: TranscriptProps) {
  const [search, setSearch] = useState('');
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const transcript = useRef<HTMLDivElement>(null);
  const activeRow = useRef<HTMLButtonElement>(null);
  const savedIds = useMemo(() => new Set(favorites), [favorites]);
  const filtered = useMemo(() => {
    const phrase = search.trim();
    return lesson.segments
      .map((s, n) => ({ segment: s, index: n }))
      .filter(
        (item) =>
          (!onlyFavorites || savedIds.has(item.segment.id)) &&
          (!search || item.segment.japanese.includes(phrase)),
      );
  }, [lesson.segments, onlyFavorites, savedIds, search]);
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
  }, [index, search, onlyFavorites]);
  return (
    <aside className="transcript-card" aria-labelledby="transcript-title">
      <div className="transcript-heading">
        <div>
          <span className="eyebrow">FOLLOW THE CONVERSATION</span>
          <h2 id="transcript-title">Your transcript</h2>
        </div>
        <span className="transcript-count">{lesson.segments.length}</span>
      </div>
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
      <div
        className="transcript-scroll"
        ref={transcript}
        tabIndex={0}
        aria-label="Timestamped Japanese sections"
      >
        <div>
          {filtered.map((item) => (
            <button
              key={item.segment.id}
              ref={item.index === index ? activeRow : undefined}
              data-testid={`transcript-${item.index}`}
              aria-current={item.index === index ? 'true' : undefined}
              className={`transcript-row ${item.index === index ? 'current' : item.index < index ? 'past' : ''}`}
              disabled={recording}
              onClick={() => navigate(item.index, ready)}
            >
              <span className="row-number">
                {item.index === index ? (
                  <AudioLines size={16} />
                ) : item.index < index ? (
                  <Check size={13} />
                ) : (
                  String(item.index + 1).padStart(2, '0')
                )}
              </span>
              <span className="row-content">
                <span className="row-time">
                  {timestamp(item.segment.start)}
                  {savedIds.has(item.segment.id) ? (
                    <Bookmark size={11} fill="currentColor" />
                  ) : null}
                </span>
                <span lang="ja">
                  <JapaneseText text={item.segment.japanese} furigana={furigana} />
                </span>
              </span>
              {item.index === index ? <span className="active-dot" /> : null}
            </button>
          ))}
        </div>
        {!filtered.length ? (
          <p className="transcript-empty">
            {onlyFavorites
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
