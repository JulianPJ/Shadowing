'use client';
import Link from 'next/link';
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, Compass, LoaderCircle } from 'lucide-react';
import type { useLibrary } from '../use-library';
import { useLearnerProfile } from '../use-learner-profile';
import { useAccount } from '../account';
import {
  BANDS,
  DEFAULT_FILTERS,
  DEFAULT_PREFERENCES,
  type Card,
  type Context,
  type Feed,
  type Filters,
  type Preferences,
} from '@/lib/discover/types';
import { normalizeFilters, filtersQuery } from '@/lib/discover/validation';
import {
  discoveryContext,
  discoveryPreferences,
  saveDiscoveryPreferences,
  giveFeedback,
  rememberSeen,
  recordDiscoveryEvents,
} from '@/lib/discover/client';
import { addQueueLink, loadLibrary, saveLibrary } from '@/lib/library/client';
import { readStorage, writeStorage, storageAccount } from '@/lib/storage/browser';
import { DiscoverFilters } from './filters';
import { DiscoverPreferences } from './preferences';
import { VideoCard } from './video-card';
import { localVocabularyFit } from '@/lib/discover/vocabulary';
/** Home → Discover. Browsing and saving never acquire captions or run AI. */
export function DiscoverFeed({ library: shared }: { library: ReturnType<typeof useLibrary> }) {
  const { state: library, ready: libraryReady } = shared,
    { profile } = useLearnerProfile(),
    account = useAccount();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS),
    [preferences, setPreferences] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [ready, setReady] = useState(false),
    [feed, setFeed] = useState<Feed | null>(null),
    [items, setItems] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [noticeError, setNoticeError] = useState(false);
  const [edit, setEdit] = useState(false),
    [revision, setRevision] = useState(0),
    [undo, setUndo] = useState<(() => void) | null>(null);
  const generation = useRef(0),
    context = useRef<Context | null>(null),
    controller = useRef<AbortController | null>(null),
    returnPosition = useRef<{ y: number; pages: number } | null>(null);
  const restore = useCallback(() => {
    returnPosition.current = null;
    const prefs = discoveryPreferences();
    setPreferences(prefs);
    try {
      const params = new URLSearchParams(window.location.search);
      // Other query parameters (such as a prefilled ?video= link) are not feed filters.
      const restored = [...params.keys()].some((key) => key in DEFAULT_FILTERS)
        ? normalizeFilters(params)
        : normalizeFilters(
            readStorage('discover:filters', {
              ...DEFAULT_FILTERS,
              duration: prefs.duration,
              diversity: prefs.diversity,
            }),
          );
      setFilters(restored);
      const position = readStorage<{
        query: string;
        y: number;
        pages: number;
        savedAt: number;
      } | null>('discover:return', null);
      if (
        position &&
        position.query === filtersQuery(restored) &&
        position.savedAt > Date.now() - 10 * 60000 &&
        Number.isFinite(position.y) &&
        Number.isInteger(position.pages) &&
        position.pages >= 1 &&
        position.pages <= 42
      ) {
        returnPosition.current = { y: Math.max(0, position.y), pages: position.pages };
      }
    } catch {
      setFilters(DEFAULT_FILTERS);
    }
    setReady(true);
  }, []);
  useEffect(() => {
    const epoch = generation;
    // Browser preferences and navigation state become available after hydration.
    restore();
    window.addEventListener('popstate', restore);
    const changed = () => {
      epoch.current++;
      controller.current?.abort();
      setFeed(null);
      setItems([]);
      restore();
      setRevision((n) => n + 1);
    };
    window.addEventListener('hibiki:account-change', changed);
    return () => {
      epoch.current++;
      controller.current?.abort();
      window.removeEventListener('popstate', restore);
      window.removeEventListener('hibiki:account-change', changed);
    };
  }, [restore]);
  useEffect(() => {
    const changed = (event: Event) => {
      if ((event as CustomEvent<{ kind: string }>).detail?.kind === 'queue') return;
      setPreferences(discoveryPreferences());
      setRevision((n) => n + 1);
    };
    window.addEventListener('hibiki:discover-change', changed);
    return () => window.removeEventListener('hibiki:discover-change', changed);
  }, []);
  const fetchPage = useCallback(
    async function requestPage(cursor: string | null, initial: boolean) {
      if (!context.current) return;
      const owner = storageAccount(),
        ticket = ++generation.current;
      controller.current?.abort();
      const cancellation = new AbortController();
      controller.current = cancellation;
      setLoading(true);
      setError('');
      try {
        const response = await fetch('/api/discover', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filters, context: context.current, cursor }),
          cache: 'no-store',
          signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(15000)]),
        });
        const data = await response.json();
        if (owner !== storageAccount() || ticket !== generation.current) return;
        if (!response.ok) {
          if (response.status === 400) {
            setFeed(null);
            setItems([]);
          }
          throw new Error(data.error ?? 'Discovery is temporarily unavailable.');
        }
        const next = data as Feed;
        setFeed((previous) => ({
          ...next,
          lanes: initial ? next.lanes : (previous?.lanes ?? next.lanes),
        }));
        setItems((previous) =>
          initial
            ? next.items
            : [
                ...previous,
                ...next.items.filter((v) => !previous.some((p) => p.videoId === v.videoId)),
              ],
        );
        rememberSeen([
          ...next.lanes.flatMap((l) => l.items.map((v) => v.videoId)),
          ...next.items.map((v) => v.videoId),
        ]);
        void recordDiscoveryEvents(
          next.items.map((v) => ({ videoId: v.videoId, action: 'impression' })),
        );
        if (initial && !Object.keys(context.current?.vocabularyFit ?? {}).length) {
          void localVocabularyFit(next.items, cancellation.signal)
            .then((fit) => {
              if (
                ticket !== generation.current ||
                owner !== storageAccount() ||
                !Object.keys(fit).length ||
                !context.current
              )
                return;
              context.current = { ...context.current, vocabularyFit: fit };
              void requestPage(null, true);
            })
            .catch(() => {
              /* Missing local analysis leaves the fast initial feed intact. */
            });
        }
      } catch (error) {
        if (ticket === generation.current && !cancellation.signal.aborted)
          setError(
            error instanceof Error ? error.message : 'Discovery is temporarily unavailable.',
          );
      } finally {
        if (ticket === generation.current) setLoading(false);
      }
    },
    [filters],
  );
  const refreshFeed = useEffectEvent(() => {
    context.current = discoveryContext(account.loaded ? profile : null);
    setFeed(null);
    setItems([]);
    void fetchPage(null, true);
  });
  useEffect(() => {
    if (!ready || !libraryReady || !account.loaded) return;
    // Reset the in-flight request when browser-owned inputs or account hydration change.
    refreshFeed();
  }, [ready, libraryReady, profile, account.loaded, account.user?.id, revision, fetchPage]);
  useEffect(() => {
    const position = returnPosition.current;
    if (!position || loading || !feed || !items.length) return;
    if (feed.hasMore && Math.ceil(items.length / 24) < position.pages) {
      void fetchPage(feed.nextCursor, false);
    } else {
      window.scrollTo(0, position.y);
      returnPosition.current = null;
      writeStorage('discover:return', null);
    }
  }, [loading, feed, items, fetchPage]);
  function change(next: Filters) {
    returnPosition.current = null;
    setFilters(next);
    writeStorage('discover:filters', next);
    const query = filtersQuery(next);
    window.history.pushState(null, '', `${window.location.pathname}${query ? '?' + query : ''}`);
  }
  function save(video: Card) {
    setNoticeError(false);
    try {
      const state = loadLibrary(),
        existing = state.queue.find((q) => q.url === video.canonicalUrl);
      const stored = existing
        ? saveLibrary({ ...state, queue: state.queue.filter((q) => q.id !== existing.id) })
        : addQueueLink(video.canonicalUrl, video.title);
      setNotice(
        existing
          ? 'Removed from Watch Later.'
          : stored
            ? 'Saved to Watch Later.'
            : 'Saved for this visit. Browser storage is unavailable.',
      );
      setUndo(() => () => {
        const current = loadLibrary();
        if (existing && !current.queue.some((q) => q.url === video.canonicalUrl))
          addQueueLink(video.canonicalUrl, video.title);
        else if (!existing)
          saveLibrary({
            ...current,
            queue: current.queue.filter((q) => q.url !== video.canonicalUrl),
          });
        setUndo(null);
        setNotice('Change undone.');
      });
      if (!existing) void recordDiscoveryEvents([{ videoId: video.videoId, action: 'save' }]);
    } catch (error) {
      setNoticeError(true);
      setNotice(error instanceof Error ? error.message : 'This video could not be saved.');
    }
  }
  function feedback(video: Card, action: 'not_interested' | 'more_like_this') {
    const saved = giveFeedback(video.videoId, action);
    setNoticeError(false);
    setNotice(
      `${action === 'not_interested' ? 'Hidden from your recommendations.' : 'We’ll show more like this.'}${saved ? '' : ' Saved for this visit; browser storage is unavailable.'}`,
    );
    setUndo(() => () => {
      giveFeedback(video.videoId, 'reset');
      setNotice('Feedback undone.');
      setUndo(null);
    });
  }
  const suggested = preferences.preferredBand ?? feed?.suggestedBand ?? null;
  const bandLabel = suggested ? BANDS.find((b) => b[0] === suggested)![1] : null;
  const lanes = feed?.lanes ?? [],
    laneIds = new Set(lanes.flatMap((l) => l.items.map((v) => v.videoId)));
  const card = (video: Card) => (
    <VideoCard
      key={video.videoId}
      video={video}
      saved={library.queue.some((q) => q.url === video.canonicalUrl)}
      onSave={() => save(video)}
      onFeedback={(action) => feedback(video, action)}
      onOpen={() => {
        writeStorage('discover:filters', filters);
        writeStorage('discover:return', {
          query: filtersQuery(filters),
          y: window.scrollY,
          pages: Math.ceil(items.length / 24),
          savedAt: Date.now(),
        });
      }}
    />
  );
  return (
    <>
      <section className="discover-main" aria-label="Discover">
        <section className="discover-personal" aria-label="Your discovery level">
          <div>
            <span className="eyebrow">
              {preferences.preferredBand ? 'YOUR PREFERRED CONTENT LEVEL' : 'SUGGESTED FOR YOU'}
            </span>
            <h2>Find something worth listening to</h2>
            <p>
              {bandLabel
                ? `${preferences.preferredBand ? 'Your starting point' : 'Suggested from your practice'}: ${bandLabel}.`
                : 'Follow your interests, or choose a level to start from.'}
            </p>
          </div>
          <div className="discover-personal-actions">
            <span className="discover-level-display">{bandLabel ?? 'Your own pace'}</span>
            <button className="button discover-primary" onClick={() => setEdit(true)}>
              Edit level
            </button>
          </div>
        </section>
        <div className="section-heading discover-feed-heading">
          <h2>Your discovery feed</h2>
          <button
            className="text-button"
            onClick={() => setRevision((n) => n + 1)}
            disabled={loading}
          >
            <RefreshCw size={15} /> Refresh
          </button>
        </div>
        <DiscoverFilters key={filters.q} value={filters} onChange={change} />
        {notice ? (
          <div className="discover-notice" role={noticeError ? 'alert' : 'status'}>
            {notice}
            {undo ? (
              <button
                className="text-button"
                onClick={() => {
                  try {
                    undo();
                  } catch (error) {
                    setNoticeError(true);
                    setNotice(error instanceof Error ? error.message : 'Unable to undo.');
                  }
                }}
              >
                Undo
              </button>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="discover-empty" role="alert">
            <Compass size={30} />
            <h2>Discovery needs a moment.</h2>
            <p>{error}</p>
            <button
              className="button"
              onClick={() => void fetchPage(feed?.nextCursor ?? null, !feed)}
            >
              Try again
            </button>
            <Link className="text-button" href="/practice/demo">
              Try the studio sample <ArrowRight size={15} />
            </Link>
          </div>
        ) : null}
        {loading && !feed ? (
          <div
            className="discover-skeleton-grid"
            role="status"
            aria-label="Finding Japanese videos"
          >
            {[0, 1, 2].map((i) => (
              <div className="discover-skeleton" key={i}>
                <div />
                <span />
                <span />
              </div>
            ))}
            <span className="sr-only">Finding Japanese videos…</span>
          </div>
        ) : null}
        {!loading && !error && feed?.total === 0 ? (
          <div className="discover-empty">
            <Compass size={32} />
            <h2>
              {Object.entries(filters).some(([k, v]) => v !== DEFAULT_FILTERS[k as keyof Filters])
                ? 'Make a little more room to explore.'
                : 'New discoveries are on their way.'}
            </h2>
            <p>
              {filters.band !== 'for_you' && filters.band !== 'all'
                ? 'Only videos with a verified Hibiki estimate appear in a level filter. Try All levels for more possibilities.'
                : 'Try another topic or relax a filter. New videos join the catalogue as it refreshes.'}
            </p>
            <button className="button" onClick={() => change(DEFAULT_FILTERS)}>
              Reset filters
            </button>
            <Link className="text-button" href="/practice/demo">
              Try the studio sample <ArrowRight size={15} />
            </Link>
          </div>
        ) : null}
        {lanes.map((lane) => (
          <section key={lane.key} className="discover-lane" aria-labelledby={`lane-${lane.key}`}>
            <div className="section-heading">
              <h2 id={`lane-${lane.key}`}>{lane.title}</h2>
            </div>
            <div className="discover-grid">{lane.items.map(card)}</div>
          </section>
        ))}
        {items.some((v) => !laneIds.has(v.videoId)) ? (
          <section className="discover-lane">
            <div className="section-heading">
              <h2>
                {filters.q ? `Results for “${filters.q}”` : 'Explore all'}{' '}
                <span className="small muted">{feed?.total} possibilities</span>
              </h2>
            </div>
            <div className="discover-grid">
              {items.filter((v) => !laneIds.has(v.videoId)).map(card)}
            </div>
          </section>
        ) : null}
        {feed?.hasMore ? (
          <div className="discover-pagination">
            <button
              className="button"
              disabled={loading}
              onClick={() => void fetchPage(feed.nextCursor, false)}
            >
              {loading ? <LoaderCircle size={17} className="spin" /> : null}
              {loading ? 'Finding more…' : 'Discover more'}
            </button>
          </div>
        ) : null}
        {feed?.catalogueUpdatedAt ? (
          <p className="small muted discover-freshness">
            Catalogue refreshed {new Date(feed.catalogueUpdatedAt).toLocaleDateString()}. Captions
            and availability are confirmed when you start.
          </p>
        ) : null}
        {edit ? (
          <DiscoverPreferences
            initial={preferences}
            onClose={() => setEdit(false)}
            onSave={(value) => {
              const saved = saveDiscoveryPreferences(value);
              setPreferences(value);
              change({
                ...filters,
                band: 'for_you',
                duration: value.duration,
                diversity: value.diversity,
              });
              setEdit(false);
              setNoticeError(false);
              setNotice(
                saved
                  ? 'Your discovery preferences are saved.'
                  : 'Preferences saved for this visit. Browser storage is unavailable.',
              );
            }}
          />
        ) : null}
      </section>
    </>
  );
}
