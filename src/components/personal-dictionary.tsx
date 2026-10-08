'use client';
import Link from 'next/link';
import { ExternalLink, Play, Trash2 } from 'lucide-react';
import { useEffect, useState, useMemo, useRef } from 'react';
import { listDictionary, dictionaryPage, removeDictionary } from '@/lib/dictionary/client';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { timestamp } from '@/lib/youtube';
import { useAccount } from './account';
import { useReview } from './use-review';
import { ReviewEntryActions } from './review-entry-actions';
import { cachedReview, changeReview, pendingReview } from '@/lib/review/client';
import { dueReviews } from '@/lib/review-scheduler';
import { vocabularyCsv, vocabularyTsv, vocabularyRows } from '@/lib/export/vocabulary';
import { externalReplay, reviewContextHref } from '@/lib/dictionary/replay';
import { TagControls } from './tag-controls';
import { listTags, changeTags } from '@/lib/tags/client';
import type { Tag } from '@/lib/tags/types';
import { StandaloneNavigation } from './chrome';
import { DeckCollections } from './deck-collections';

type DictionaryView = 'saved' | 'decks';
export function PersonalDictionary({
  view = 'saved',
  deckId = 'all',
}: {
  view?: DictionaryView;
  deckId?: string;
}) {
  const account = useAccount();
  return (
    <DictionaryContent
      key={`${account.user?.id ?? 'anonymous'}:${view}:${deckId}`}
      view={view}
      initialDeck={deckId}
    />
  );
}
function DictionaryContent({ view, initialDeck }: { view: DictionaryView; initialDeck: string }) {
  const account = useAccount(),
    review = useReview();
  const [deck, setDeck] = useState(initialDeck),
    [tag, setTag] = useState('all');
  const [tagData, setTagData] = useState<{ owner: string; tags: Tag[] } | null>(null);
  const tags = tagData && tagData.owner === account.user?.id ? tagData.tags : [];
  const generation = useRef(0);
  const [term, setTerm] = useState(''),
    [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const query = useMemo(
    () => ({
      ...(deck !== 'all' ? { deckId: deck } : {}),
      ...(tag !== 'all' ? { tagId: tag } : {}),
      ...(search ? { search } : {}),
    }),
    [deck, tag, search],
  );
  const queryKey = JSON.stringify(query);
  const [selected, setSelected] = useState<string[]>([]),
    [destination, setDestination] = useState('inbox');
  const [loaded, setLoaded] = useState<{
    userId: string;
    queryKey: string;
    entries: DictionaryEntry[];
    error: string;
  } | null>(null);
  const [actionError, setActionError] = useState(''),
    [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);
  useEffect(() => {
    const userId = account.user?.id;
    if (!userId || view !== 'saved') return;
    let active = true,
      requestGeneration = 0;
    const paginationGeneration = generation;
    paginationGeneration.current++;
    const key = JSON.stringify(query);
    const load = () => {
      const request = ++requestGeneration;
      paginationGeneration.current++;
      void dictionaryPage(query)
        .then((page) => {
          if (active && request === requestGeneration) {
            setLoaded({ userId, queryKey: key, entries: page.entries, error: '' });
            setNextCursor(page.nextCursor);
            setOffline(!!page.offline);
          }
        })
        .catch((reason) => {
          if (active && request === requestGeneration)
            setLoaded({
              userId,
              queryKey: key,
              entries: [],
              error: reason instanceof Error ? reason.message : 'Your saved words are unavailable.',
            });
        });
    };
    load();
    const membershipKey = () =>
      cachedReview()
        .memberships.filter((member) => member.deckId === query.deckId)
        .map((member) => member.entryId)
        .sort()
        .join(',');
    let memberships = membershipKey(),
      waitingForSync = pendingReview().length > 0;
    const reviewChanged = () => {
      if (!query.deckId) return;
      if (pendingReview().length) {
        waitingForSync = true;
        return;
      }
      const current = membershipKey();
      if (waitingForSync || current !== memberships) load();
      memberships = current;
      waitingForSync = false;
    };
    const refreshTags = () => {
      void listTags()
        .then((values) => {
          if (active) {
            setTagData({ owner: userId, tags: values });
            if (query.tagId && !values.some((value) => value.id === query.tagId)) setTag('all');
          }
        })
        .catch(() => {});
    };
    const refresh = () => {
      load();
      refreshTags();
    };
    refreshTags();
    window.addEventListener('hibiki:dictionary-change', refresh);
    window.addEventListener('hibiki:review-change', reviewChanged);
    return () => {
      active = false;
      paginationGeneration.current++;
      window.removeEventListener('hibiki:dictionary-change', refresh);
      window.removeEventListener('hibiki:review-change', reviewChanged);
    };
  }, [account.user?.id, query, attempt, view]);
  const ownsResults =
    !!account.user && loaded?.userId === account.user.id && loaded.queryKey === queryKey;
  const entries = ownsResults ? loaded.entries : [];
  const loading = !!account.user && !ownsResults;
  const loadError = ownsResults ? loaded.error : '';
  const visible = entries.filter(
    (entry) =>
      deck === 'all' ||
      review.data.memberships.some(
        (member) => member.deckId === deck && member.entryId === entry.id,
      ),
  );
  const chosen = selected.filter((id) => visible.some((entry) => entry.id === id));
  const activeFilters = deck !== 'all' || tag !== 'all' || !!search;
  function clearFilters() {
    setDeck('all');
    setTag('all');
    setSearch('');
    setTerm('');
    setSelected([]);
  }
  function organize(action: 'add' | 'move' | 'enroll' | 'remove') {
    if (!chosen.length || !review.data.decks.some((value) => value.id === destination)) return;
    try {
      if (action === 'enroll')
        changeReview({
          action: 'enroll',
          entryIds: chosen,
          deckId: destination,
          enrolledAt: new Date().toISOString(),
        });
      else if (action === 'remove')
        changeReview({ action: 'membership', entryIds: chosen, deckId: deck, remove: true });
      else {
        changeReview({
          action: 'membership',
          entryIds: chosen,
          deckId: destination,
          remove: false,
        });
        if (action === 'move')
          for (const other of review.data.decks.filter((value) => value.id !== destination)) {
            const ids = chosen.filter((id) =>
              review.data.memberships.some(
                (member) => member.deckId === other.id && member.entryId === id,
              ),
            );
            if (ids.length)
              changeReview({ action: 'membership', entryIds: ids, deckId: other.id, remove: true });
          }
      }
      setActionError('');
      setNotice(
        `${chosen.length} ${chosen.length === 1 ? 'word' : 'words'} ${action === 'enroll' ? 'added to review' : action === 'move' ? 'moved to the chosen deck' : action === 'remove' ? 'removed from this deck' : 'added to the chosen deck'}. Changes saved on this device.`,
      );
      if (action === 'move' || action === 'remove') setSelected([]);
    } catch (reason) {
      setActionError(
        reason instanceof Error ? reason.message : 'Could not update the selected words.',
      );
    }
  }
  async function loadMore() {
    if (!nextCursor || busy || !account.user) return;
    const userId = account.user.id,
      epoch = generation.current;
    setBusy(true);
    setActionError('');
    try {
      const page = await dictionaryPage({ ...query, cursor: nextCursor }, true);
      if (epoch !== generation.current) return;
      setLoaded((current) =>
        current?.userId === userId && current.queryKey === queryKey
          ? {
              ...current,
              entries: [
                ...new Map(
                  [...current.entries, ...page.entries].map((entry) => [entry.id, entry]),
                ).values(),
              ],
            }
          : current,
      );
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not load more words.');
    } finally {
      setBusy(false);
    }
  }
  async function exportWords(
    scope: 'selected' | 'filtered' | 'all',
    format: 'csv' | 'tsv' = 'csv',
  ) {
    setBusy(true);
    setActionError('');
    try {
      const values =
        scope === 'selected'
          ? entries.filter((entry) => chosen.includes(entry.id))
          : await listDictionary(scope === 'filtered' ? query : {});
      const rows = vocabularyRows(values, review.data),
        blob = new Blob([format === 'csv' ? vocabularyCsv(rows) : vocabularyTsv(rows)], {
          type:
            format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8',
        });
      const url = URL.createObjectURL(blob),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'hibiki-words.' + format;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${values.length} ${scope === 'all' ? 'saved' : scope} words.`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not export these words.');
    } finally {
      setBusy(false);
    }
  }
  async function tagEntries(tagId: string, ids: string[], remove = false) {
    if (!tagId || !ids.length) return;
    setActionError('');
    try {
      await changeTags({ action: 'membership', tagId, entryIds: ids, remove });
      setNotice(
        remove
          ? 'Tag removed. Choose it again to restore it.'
          : 'Tag applied to the selected words.',
      );
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not update this tag.');
      throw reason;
    }
  }
  async function remove(entry: DictionaryEntry) {
    if (
      !window.confirm(
        `Delete “${entry.term}” from saved words? Its saved context, deck memberships and review card will also be removed.`,
      )
    )
      return;
    setRemoving(entry.id);
    setActionError('');
    try {
      await removeDictionary(entry.id);
      setLoaded((current) =>
        current && account.user && current.userId === account.user.id
          ? { ...current, entries: current.entries.filter((value) => value.id !== entry.id) }
          : current,
      );
      setSelected((current) => current.filter((id) => id !== entry.id));
      setNotice(`Deleted ${entry.term} from saved words.`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not remove this word.');
    } finally {
      setRemoving(null);
    }
  }
  return (
    <>
      <StandaloneNavigation vocabularyView={view} />
      <main className="dictionary-screen">
        <div className="dictionary-page-heading">
          <div>
            <h1>{view === 'decks' ? 'Decks' : 'Saved words'}</h1>
            <p>
              {view === 'decks'
                ? 'Choose a deck to study, browse its words or manage its name.'
                : 'Words and phrases you chose to keep, with their meaning and original Japanese context.'}
            </p>
          </div>
          {account.user && view === 'saved' && !loading ? (
            <span className="dictionary-count">
              {visible.length} saved words loaded{nextCursor ? ' · more available' : ''}
            </span>
          ) : null}
        </div>
        {!account.user ? (
          <section className="dictionary-empty">
            <h2>Keep vocabulary with its context.</h2>
            <p>
              Sign in, then choose a Japanese word or phrase during practice to save it here. You
              can mark word knowledge on this device without an account.
            </p>
            <Link
              className="button primary"
              href={`/sign-in?returnTo=${encodeURIComponent(view === 'decks' ? '/dictionary?view=decks' : '/dictionary')}`}
            >
              Sign in
            </Link>
            <Link className="button" href="/words">
              Explore word knowledge
            </Link>
          </section>
        ) : view === 'decks' ? (
          review.loading ? (
            <p role="status">Opening your decks…</p>
          ) : (
            <DeckCollections data={review.data} onError={setActionError} />
          )
        ) : (
          <>
            <section className="saved-words-filters" aria-label="Filter saved words">
              <label>
                Filter by deck
                <select
                  value={deck}
                  onChange={(event) => {
                    setDeck(event.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="all">All saved words</option>
                  {review.data.decks.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Filter by tag
                <select
                  value={tag}
                  onChange={(event) => {
                    setTag(event.target.value);
                    setSelected([]);
                  }}
                >
                  <option value="all">All tags</option>
                  {tags.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </label>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  setSearch(term.trim());
                  setSelected([]);
                }}
              >
                <label>
                  Search saved words
                  <input
                    value={term}
                    maxLength={120}
                    onChange={(event) => setTerm(event.target.value)}
                    placeholder="Japanese, reading or meaning"
                  />
                </label>
                <button className="button small-button">Search</button>
              </form>
              {activeFilters ? (
                <button className="text-button" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : null}
              <Link
                className="button primary"
                href={deck === 'all' ? '/review' : `/review?deck=${encodeURIComponent(deck)}`}
              >
                Study {deck === 'all' ? 'all decks' : 'this deck'} ·{' '}
                {
                  dueReviews(
                    review.data.cards.filter(
                      (card) =>
                        deck === 'all' ||
                        review.data.memberships.some(
                          (member) => member.deckId === deck && member.entryId === card.entryId,
                        ),
                    ),
                    new Date().toISOString(),
                  ).length
                }{' '}
                ready
              </Link>
            </section>
            <p className="small muted collection-explanation">
              Inbox is the default collection for newly saved words. Saved only words stay as
              reference; Add to review schedules them for study. Adding or moving between decks
              keeps one schedule.
            </p>
            <section className="saved-words-bulk" aria-label="Organize selected words">
              <div className="collection-selection">
                <strong>{chosen.length} selected</strong>
                {visible.length ? (
                  <label className="review-selection">
                    <input
                      type="checkbox"
                      checked={visible.every((entry) => chosen.includes(entry.id))}
                      onChange={(event) =>
                        setSelected(event.target.checked ? visible.map((entry) => entry.id) : [])
                      }
                    />
                    Select all {visible.length} loaded words
                  </label>
                ) : null}
                {chosen.length ? (
                  <button className="text-button" onClick={() => setSelected([])}>
                    Clear selection
                  </button>
                ) : null}
              </div>
              <p className="small muted">
                Selection covers loaded words in this view. Load more to extend it; changing filters
                clears selection. Study uses the deck’s queue without selecting cards.
              </p>
              <div className="collection-bulk-actions">
                <label>
                  Destination deck
                  <select
                    value={destination}
                    onChange={(event) => setDestination(event.target.value)}
                  >
                    {review.data.decks.map((value) => (
                      <option key={value.id} value={value.id}>
                        {value.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="button small-button"
                  disabled={!chosen.length}
                  onClick={() => organize('enroll')}
                >
                  Add selected to review
                </button>
                <button
                  className="button small-button"
                  disabled={!chosen.length}
                  onClick={() => organize('add')}
                >
                  Add selected to deck
                </button>
                <button
                  className="button small-button"
                  disabled={!chosen.length}
                  onClick={() => organize('move')}
                >
                  Move selected to deck
                </button>
                {deck !== 'all' ? (
                  <button
                    className="text-button"
                    disabled={!chosen.length}
                    onClick={() => organize('remove')}
                  >
                    Remove selected from deck
                  </button>
                ) : null}
                <Link className="text-button" href="/dictionary?view=decks">
                  Create or manage decks
                </Link>
              </div>
              <TagControls
                tags={tags}
                selected={chosen}
                onApply={(tagId) => tagEntries(tagId, chosen)}
                onError={setActionError}
              />
              <details className="collection-export">
                <summary>Export saved words</summary>
                <p className="small muted">
                  Selected exports include selected loaded words. Filtered exports include every
                  match across pages. Entire dictionary includes all saved words.
                </p>
                <div className="collection-bulk-actions">
                  <button
                    className="text-button"
                    disabled={busy || (!visible.length && !chosen.length)}
                    onClick={() => void exportWords(chosen.length ? 'selected' : 'filtered')}
                  >
                    Export {chosen.length ? 'selected' : 'filtered'} CSV
                  </button>
                  <button
                    className="text-button"
                    disabled={busy || (!visible.length && !chosen.length)}
                    onClick={() => void exportWords(chosen.length ? 'selected' : 'filtered', 'tsv')}
                  >
                    Export {chosen.length ? 'selected' : 'filtered'} TSV
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() => void exportWords('all')}
                  >
                    Export entire dictionary CSV
                  </button>
                </div>
              </details>
            </section>
            {loading ? (
              <p role="status">Opening your saved words…</p>
            ) : loadError ? (
              <section className="dictionary-empty">
                <h2>Saved words could not load.</h2>
                <p role="alert">{loadError}</p>
                <button className="button" onClick={() => setAttempt((value) => value + 1)}>
                  Retry saved words
                </button>
              </section>
            ) : visible.length ? (
              <div className="dictionary-list">
                {visible.map((entry) => {
                  const external = externalReplay(entry);
                  return (
                    <article className="dictionary-entry" key={entry.id}>
                      <label className="review-selection">
                        <input
                          type="checkbox"
                          checked={chosen.includes(entry.id)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...chosen, entry.id]
                                : chosen.filter((id) => id !== entry.id),
                            )
                          }
                        />
                        Select {entry.term}
                      </label>
                      <div className="dictionary-entry-term">
                        <div>
                          <h2 lang="ja">{entry.term}</h2>
                          {entry.reading ? <span lang="ja">{entry.reading}</span> : null}
                        </div>
                        <strong>{entry.translation}</strong>
                      </div>
                      <ReviewEntryActions entryId={entry.id} data={review.data} />
                      <div className="entry-tags" aria-label={`Tags for ${entry.term}`}>
                        {entry.tags?.map((value) => (
                          <button
                            className="tag-chip"
                            key={value.id}
                            onClick={() =>
                              void tagEntries(value.id, [entry.id], true).catch(() => {})
                            }
                            aria-label={`Remove tag ${value.name} from ${entry.term}`}
                          >
                            {value.name} ×
                          </button>
                        ))}
                        <label>
                          Add tag
                          <select
                            aria-label={`Add tag to ${entry.term}`}
                            value=""
                            onChange={(event) =>
                              void tagEntries(event.target.value, [entry.id]).catch(() => {})
                            }
                          >
                            <option value="">Choose tag</option>
                            {tags
                              .filter(
                                (value) => !entry.tags?.some((current) => current.id === value.id),
                              )
                              .map((value) => (
                                <option key={value.id} value={value.id}>
                                  {value.name}
                                </option>
                              ))}
                          </select>
                        </label>
                      </div>
                      <div className="dictionary-entry-context">
                        <p lang="ja">{entry.sourceSentence}</p>
                        <p>
                          {entry.sourceSentenceTranslation || 'Sentence translation not saved.'}
                        </p>
                      </div>
                      <div className="dictionary-entry-source">
                        <span>
                          {entry.source.lessonTitle} · {entry.source.lessonAuthor} ·{' '}
                          {timestamp(entry.source.start)}–{timestamp(entry.source.end)}
                        </span>
                        <div>
                          <Link className="button small-button" href={reviewContextHref(entry)}>
                            <Play size={14} />
                            Open section
                          </Link>
                          {external ? (
                            <a
                              className="text-button"
                              href={external}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {entry.source.mediaType === 'youtube'
                                ? 'Open on YouTube'
                                : entry.source.mediaType === 'vimeo'
                                  ? 'Open on Vimeo'
                                  : 'Open source media'}{' '}
                              <ExternalLink size={14} />
                            </a>
                          ) : null}
                          <button
                            className="text-button dictionary-remove"
                            disabled={removing !== null}
                            onClick={() => void remove(entry)}
                          >
                            <Trash2 size={14} />
                            {removing === entry.id ? 'Deleting…' : 'Delete saved word'}
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <section className="dictionary-empty">
                <h2>
                  {activeFilters
                    ? 'No words match these filters.'
                    : offline
                      ? 'No saved words are cached on this device.'
                      : 'No saved vocabulary yet.'}
                </h2>
                <p>
                  {activeFilters
                    ? 'Try part of the Japanese word, its reading or meaning, or browse all saved words.'
                    : offline
                      ? 'Reconnect to load your saved words. Practice and local word knowledge are still available.'
                      : 'Open a lesson, choose a Japanese word or phrase, then save it with its context.'}
                </p>
                {activeFilters ? (
                  <button className="button" onClick={clearFilters}>
                    Show all saved words
                  </button>
                ) : (
                  <Link className="button primary" href="/practice/demo">
                    Try it in the demo
                  </Link>
                )}
              </section>
            )}
            {nextCursor && !loading ? (
              <button className="button" disabled={busy} onClick={() => void loadMore()}>
                {busy ? 'Loading…' : 'Load more saved words'}
              </button>
            ) : null}
            {offline ? (
              <p role="status">
                Showing saved words cached on this device. Connect to load the full collection and
                export every match.
              </p>
            ) : null}
          </>
        )}
        {notice ? (
          <p className="collection-notice" role="status">
            {notice}
          </p>
        ) : null}
        {actionError ? (
          <p className="dictionary-page-error" role="alert">
            {actionError}
          </p>
        ) : null}
        {review.pending ? (
          <p role="status">Review changes saved on this device · waiting to sync</p>
        ) : null}
        {review.conflict || review.error ? (
          <p role="alert">{review.conflict || review.error}</p>
        ) : null}
      </main>
    </>
  );
}
