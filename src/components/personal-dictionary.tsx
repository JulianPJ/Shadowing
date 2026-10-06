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
import { changeReview } from '@/lib/review/client';
import { dueReviews } from '@/lib/review-scheduler';
import { vocabularyCsv, vocabularyTsv, vocabularyRows } from '@/lib/export/vocabulary';
import { externalReplay } from '@/lib/dictionary/replay';
import { TagControls } from './tag-controls';
import { listTags, changeTags } from '@/lib/tags/client';
import type { Tag } from '@/lib/tags/types';

export function PersonalDictionary() {
  const account = useAccount();
  return <DictionaryContent key={account.user?.id ?? 'anonymous'} />;
}

function DictionaryContent() {
  const account = useAccount();
  const review = useReview();
  const [deck, setDeck] = useState('all');
  const [tag, setTag] = useState('all'),
    [tagData, setTagData] = useState<{ owner: string; tags: Tag[] } | null>(null);
  const tags = tagData && tagData.owner === account.user?.id ? tagData.tags : [];
  const generation = useRef(0);
  const [term, setTerm] = useState(''),
    [search, setSearch] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [offline, setOffline] = useState(false);
  const query = useMemo(
    () => ({
      ...(deck !== 'all' ? { deckId: deck } : {}),
      ...(tag !== 'all' ? { tagId: tag } : {}),
      ...(search ? { term: search } : {}),
    }),
    [deck, tag, search],
  );
  const [deckName, setDeckName] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState<{
    userId: string;
    entries: DictionaryEntry[];
    error: string;
  } | null>(null);
  const [actionError, setActionError] = useState('');
  const [removing, setRemoving] = useState<string | null>(null);

  useEffect(() => {
    const userId = account.user?.id;
    if (!userId) return;
    let active = true;
    const paginationGeneration = generation;
    paginationGeneration.current++;
    const load = () =>
      void dictionaryPage(query)
        .then((page) => {
          if (active) {
            setLoaded({ userId, entries: page.entries, error: '' });
            setNextCursor(page.nextCursor);
            setOffline(!!page.offline);
          }
        })
        .catch((reason) => {
          if (active)
            setLoaded({
              userId,
              entries: [],
              error: reason instanceof Error ? reason.message : 'Your dictionary is unavailable.',
            });
        });
    load();
    const refresh = () => {
      load();
      void listTags()
        .then((value) => {
          if (active) {
            setTagData({ owner: userId, tags: value });
            if (query.tagId && !value.some((t) => t.id === query.tagId)) setTag('all');
          }
        })
        .catch(() => {});
    };
    void listTags()
      .then((value) => {
        if (active) {
          setTagData({ owner: userId, tags: value });
          if (query.tagId && !value.some((t) => t.id === query.tagId)) setTag('all');
        }
      })
      .catch(() => {});
    window.addEventListener('hibiki:dictionary-change', refresh);
    return () => {
      active = false;
      paginationGeneration.current++;
      window.removeEventListener('hibiki:dictionary-change', refresh);
    };
  }, [account.user?.id, query]);

  const entries = account.user && loaded?.userId === account.user.id ? loaded.entries : [];
  const loading = Boolean(account.user && loaded?.userId !== account.user.id);
  const error =
    actionError || (account.user && loaded?.userId === account.user.id ? loaded.error : '');

  const termCount = new Set(entries.map((entry) => entry.normalizedTerm)).size;
  const visible = entries.filter(
    (e) =>
      deck === 'all' ||
      review.data.memberships.some((m) => m.deckId === deck && m.entryId === e.id),
  );
  const chosen = selected.filter((id) => entries.some((e) => e.id === id));
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
        current?.userId === userId
          ? {
              ...current,
              entries: [
                ...new Map([...current.entries, ...page.entries].map((e) => [e.id, e])).values(),
              ],
            }
          : current,
      );
      setNextCursor(page.nextCursor);
    } catch (e) {
      setActionError((e as Error).message);
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
          ? entries.filter((e) => chosen.includes(e.id))
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
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function tagEntries(tagId: string, ids: string[], remove = false) {
    setActionError('');
    try {
      await changeTags({ action: 'membership', tagId, entryIds: ids, remove });
    } catch (e) {
      setActionError((e as Error).message);
    }
  }

  async function remove(entry: DictionaryEntry) {
    setRemoving(entry.id);
    setActionError('');
    try {
      await removeDictionary(entry.id);
      setLoaded((current) =>
        current && account.user && current.userId === account.user.id
          ? { ...current, entries: current.entries.filter((value) => value.id !== entry.id) }
          : current,
      );
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : 'Could not remove this entry.');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <main className="dictionary-screen">
      <div className="dictionary-page-heading">
        <div>
          <Link className="eyebrow" href="/">
            HIBIKI
          </Link>
          <h1>Personal dictionary</h1>
          <p>Words and phrases you chose to keep, attached to the Japanese you found them in.</p>
        </div>
        {account.user ? (
          <span className="dictionary-count">
            {termCount} {termCount === 1 ? 'term' : 'terms'} loaded
          </span>
        ) : null}
      </div>
      {account.user ? (
        <section className="review-toolbar" aria-label="Dictionary collections">
          <Link className="button primary" href="/review">
            Daily Review · {dueReviews(review.data.cards, new Date().toISOString()).length} due
          </Link>
          <label>
            Filter by deck{' '}
            <select value={deck} onChange={(e) => setDeck(e.target.value)}>
              <option value="all">All words</option>
              {review.data.decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Filter by tag{' '}
            <select value={tag} onChange={(e) => setTag(e.target.value)}>
              <option value="all">All tags</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(term.trim());
            }}
          >
            <label>
              Find exact term{' '}
              <input value={term} maxLength={120} onChange={(e) => setTerm(e.target.value)} />
            </label>
            <button className="button small-button">Find</button>
            {search ? (
              <button
                type="button"
                className="text-button"
                onClick={() => {
                  setSearch('');
                  setTerm('');
                }}
              >
                Clear search
              </button>
            ) : null}
          </form>
          <TagControls
            tags={tags}
            selected={chosen}
            onApply={(tagId) => void tagEntries(tagId, chosen)}
            onError={setActionError}
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (deckName.trim()) {
                changeReview({ action: 'deck', id: crypto.randomUUID(), name: deckName.trim() });
                setDeckName('');
              }
            }}
          >
            <label>
              New deck{' '}
              <input
                maxLength={80}
                value={deckName}
                onChange={(e) => setDeckName(e.target.value)}
              />
            </label>
            <button className="button small-button" disabled={!deckName.trim()}>
              Create deck
            </button>
          </form>
          {deck !== 'all' && deck !== 'inbox' ? (
            <button
              className="text-button"
              onClick={() => {
                changeReview({ action: 'delete-deck', deckId: deck });
                setDeck('all');
              }}
            >
              Delete deck
            </button>
          ) : null}
          <button
            className="button small-button"
            disabled={!chosen.length}
            onClick={() =>
              changeReview({
                action: 'enroll',
                entryIds: chosen,
                deckId: deck === 'all' ? 'inbox' : deck,
                enrolledAt: new Date().toISOString(),
              })
            }
          >
            Add selected to review
          </button>
          {deck !== 'all' ? (
            <>
              <button
                className="text-button"
                disabled={!chosen.length}
                onClick={() =>
                  changeReview({
                    action: 'membership',
                    entryIds: chosen,
                    deckId: deck,
                    remove: false,
                  })
                }
              >
                Add selected to deck
              </button>
              <button
                className="text-button"
                disabled={!chosen.length}
                onClick={() =>
                  changeReview({
                    action: 'membership',
                    entryIds: chosen,
                    deckId: deck,
                    remove: true,
                  })
                }
              >
                Remove selected from deck
              </button>
            </>
          ) : null}
          <button
            className="text-button"
            disabled={!visible.length && !chosen.length}
            onClick={() => void exportWords(chosen.length ? 'selected' : 'filtered')}
          >
            Export {chosen.length ? 'selected' : 'filtered'} CSV
          </button>
          <button className="text-button" disabled={busy} onClick={() => void exportWords('all')}>
            Export entire dictionary CSV
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => void exportWords(chosen.length ? 'selected' : 'filtered', 'tsv')}
          >
            Export {chosen.length ? 'selected' : 'filtered'} TSV
          </button>
        </section>
      ) : null}
      {!account.user ? (
        <section className="dictionary-empty">
          <h2>Keep vocabulary with its context.</h2>
          <p>
            Sign in, then click a word or select a phrase in a practice sentence to save its meaning
            and source section here.
          </p>
          <Link className="button primary" href="/sign-in">
            Sign in
          </Link>
        </section>
      ) : loading ? (
        <p role="status">Opening your dictionary…</p>
      ) : entries.length ? (
        <div className="dictionary-list">
          {visible.map((entry) => {
            const external = externalReplay(entry);
            return (
              <article className="dictionary-entry" key={entry.id}>
                <label className="review-selection">
                  <input
                    type="checkbox"
                    checked={chosen.includes(entry.id)}
                    onChange={(e) =>
                      setSelected(
                        e.target.checked
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
                  {entry.tags?.map((t) => (
                    <button
                      className="tag-chip"
                      key={t.id}
                      onClick={() => void tagEntries(t.id, [entry.id], true)}
                      aria-label={`Remove tag ${t.name} from ${entry.term}`}
                    >
                      {t.name} ×
                    </button>
                  ))}
                  <label>
                    + tag{' '}
                    <select
                      aria-label={`Add tag to ${entry.term}`}
                      value=""
                      onChange={(e) => void tagEntries(e.target.value, [entry.id])}
                    >
                      <option value="">Choose tag</option>
                      {tags
                        .filter((t) => !entry.tags?.some((current) => current.id === t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
                <div className="dictionary-entry-context">
                  <p lang="ja">{entry.sourceSentence}</p>
                  <p>{entry.sourceSentenceTranslation}</p>
                </div>
                <div className="dictionary-entry-source">
                  <span>
                    {entry.source.lessonTitle} · {entry.source.lessonAuthor} ·{' '}
                    {timestamp(entry.source.start)}–{timestamp(entry.source.end)}
                  </span>
                  <div>
                    <Link
                      className="button small-button"
                      href={`/practice/${encodeURIComponent(entry.source.lessonId)}?section=${encodeURIComponent(entry.source.segmentId)}`}
                    >
                      <Play size={14} />
                      Open section
                    </Link>
                    {external ? (
                      <a className="text-button" href={external} target="_blank" rel="noreferrer">
                        Source video <ExternalLink size={13} />
                      </a>
                    ) : null}
                    <button
                      className="text-button dictionary-remove"
                      disabled={removing === entry.id}
                      onClick={() => void remove(entry)}
                    >
                      <Trash2 size={13} />
                      {removing === entry.id ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <section className="dictionary-empty">
          <h2>No saved vocabulary yet.</h2>
          <p>Open a lesson, click a Japanese word or select a phrase, then save it here.</p>
          <Link className="button primary" href="/practice/demo">
            Try it in the demo
          </Link>
        </section>
      )}
      {nextCursor ? (
        <button className="button" disabled={busy} onClick={() => void loadMore()}>
          {busy ? 'Loading…' : 'Load more'}
        </button>
      ) : null}
      {offline ? (
        <p role="status">
          Offline · showing cached words on this device. Full exports need a connection.
        </p>
      ) : null}
      {error ? (
        <p className="dictionary-page-error" role="alert">
          {error}
        </p>
      ) : null}
      {review.pending ? (
        <p role="status">Review changes saved on this device · waiting to sync</p>
      ) : null}
      {review.conflict || review.error ? (
        <p role="alert">{review.conflict || review.error}</p>
      ) : null}
      <p className="small muted">
        Saving keeps a word in Inbox. Add to review when you want to remember it. Basic decks,
        review and export are included in Free.
      </p>
    </main>
  );
}
