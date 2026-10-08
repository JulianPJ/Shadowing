'use client';
import { Search, SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { BANDS, TOPICS, DEFAULT_FILTERS, type Filters as Values } from '@/lib/discover/types';
export function DiscoverFilters({
  value,
  onChange,
}: {
  value: Values;
  onChange: (value: Values) => void;
}) {
  const [search, setSearch] = useState(value.q);
  const [advanced, setAdvanced] = useState(false);
  const active = Object.entries(value).filter(
    ([key, selected]) => selected !== DEFAULT_FILTERS[key as keyof Values],
  );
  return (
    <section className="discover-controls" aria-label="Discover filters">
      <div className="discover-controls-top">
        <div>
          <span className="eyebrow">LEVEL</span>
          <div className="discover-levels" role="group" aria-label="Content level">
            {(
              [
                ['for_you', 'For you'],
                ...BANDS.map((b) => [b[0], b[1]]),
                ['all', 'All levels'],
              ] as [Values['band'], string][]
            ).map(([band, label]) => (
              <button
                key={band}
                aria-pressed={value.band === band}
                onClick={() => onChange({ ...value, band })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <form
          className="discover-search"
          onSubmit={(event) => {
            event.preventDefault();
            onChange({ ...value, q: search });
          }}
        >
          <label className="sr-only" htmlFor="discover-search">
            Search Japanese videos
          </label>
          <Search size={18} />
          <input
            id="discover-search"
            type="search"
            maxLength={120}
            placeholder="Search Japanese videos"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button type="submit" aria-label="Search videos">
            <Arrow />
          </button>
        </form>
      </div>
      <div className="discover-filter-bar">
        <label>
          Topic
          <select
            aria-label="Topic"
            value={value.topic}
            onChange={(e) => onChange({ ...value, topic: e.target.value as Values['topic'] })}
          >
            <option value="all">All topics</option>
            {Object.entries(TOPICS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Duration
          <select
            aria-label="Duration"
            value={value.duration}
            onChange={(e) => onChange({ ...value, duration: e.target.value as Values['duration'] })}
          >
            {[
              ['any', 'Any length'],
              ['under5', 'Under 5 minutes'],
              ['5to10', '5–10 minutes'],
              ['10to20', '10–20 minutes'],
              ['over20', 'Over 20 minutes'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Speech speed
          <select
            aria-label="Speech speed"
            value={value.speed}
            onChange={(e) => onChange({ ...value, speed: e.target.value as Values['speed'] })}
          >
            {[
              ['any', 'Any speed'],
              ['slow', 'Slow'],
              ['natural', 'Natural'],
              ['fast', 'Fast'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Captions
          <select
            aria-label="Captions"
            value={value.captions}
            onChange={(e) => onChange({ ...value, captions: e.target.value as Values['captions'] })}
          >
            {[
              ['any', 'Any'],
              ['reported', 'Reported by YouTube'],
              ['prepared', 'Japanese prepared in Hibiki'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Sort
          <select
            aria-label="Sort"
            value={value.sort}
            onChange={(e) => onChange({ ...value, sort: e.target.value as Values['sort'] })}
          >
            {[
              ['recommended', 'For you'],
              ['newest', 'Recently added'],
              ['shortest', 'Shortest first'],
              ['trending', 'Trending in Hibiki'],
            ].map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details className="discover-extra-filters">
        <summary
          onClick={(event) => {
            if (window.matchMedia('(max-width: 640px)').matches) {
              event.preventDefault();
              setAdvanced(true);
            }
          }}
        >
          <SlidersHorizontal size={14} /> More ways to explore
        </summary>
        {!advanced ? <AdvancedControls value={value} onChange={onChange} /> : null}
      </details>
      {advanced ? (
        <AdvancedSheet value={value} onChange={onChange} onClose={() => setAdvanced(false)} />
      ) : null}
      {active.length ? (
        <div className="discover-active-filters" aria-label="Active filters">
          {active.map(([key, selected]) => (
            <button
              key={key}
              onClick={() => onChange({ ...value, [key]: DEFAULT_FILTERS[key as keyof Values] })}
              aria-label={`Remove ${key === 'q' ? 'search' : key} filter`}
            >
              {filterLabel(key, selected)} <span aria-hidden="true">×</span>
            </button>
          ))}
          <button className="text-button" onClick={() => onChange(DEFAULT_FILTERS)}>
            Clear all
          </button>
        </div>
      ) : null}
    </section>
  );
}
function filterLabel(key: string, selected: string) {
  if (key === 'q') return `“${selected}”`;
  if (key === 'band') return BANDS.find(([band]) => band === selected)?.[1] ?? 'All levels';
  if (key === 'topic') return TOPICS[selected as keyof typeof TOPICS];
  const labels: Record<string, Record<string, string>> = {
    duration: {
      under5: 'Under 5 minutes',
      '5to10': '5–10 minutes',
      '10to20': '10–20 minutes',
      over20: 'Over 20 minutes',
    },
    speed: { slow: 'Slow speech', natural: 'Natural speech', fast: 'Fast speech' },
    captions: { reported: 'YouTube reports captions', prepared: 'Japanese prepared in Hibiki' },
    sort: { newest: 'Recently added', shortest: 'Shortest first', trending: 'Trending in Hibiki' },
    audience: { learner: 'For learners', native: 'For native audiences' },
    diversity: { wide: 'More variety' },
  };
  return labels[key]?.[selected] ?? selected;
}
function AdvancedControls({
  value,
  onChange,
}: {
  value: Values;
  onChange: (value: Values) => void;
}) {
  return (
    <div className="discover-advanced-controls">
      <label>
        Content orientation
        <select
          value={value.audience}
          onChange={(e) => onChange({ ...value, audience: e.target.value as Values['audience'] })}
        >
          <option value="any">Any orientation</option>
          <option value="learner">For learners · verified only</option>
          <option value="native">For native audiences · verified only</option>
        </select>
      </label>
      <label>
        Variety
        <select
          value={value.diversity}
          onChange={(e) => onChange({ ...value, diversity: e.target.value as Values['diversity'] })}
        >
          <option value="balanced">Balanced</option>
          <option value="wide">More variety</option>
        </select>
      </label>
    </div>
  );
}
function AdvancedSheet({
  value,
  onChange,
  onClose,
}: {
  value: Values;
  onChange: (value: Values) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="discover-preferences discover-filter-sheet"
      aria-labelledby="discover-filter-title"
      onCancel={onClose}
    >
      <div className="section-heading">
        <h2 id="discover-filter-title">More ways to explore</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close filters">
          <X size={20} />
        </button>
      </div>
      <AdvancedControls value={value} onChange={onChange} />
      <button className="button discover-primary" onClick={onClose}>
        Done
      </button>
    </dialog>
  );
}
function Arrow() {
  return <span aria-hidden="true">→</span>;
}
