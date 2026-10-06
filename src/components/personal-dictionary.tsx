'use client';
import Link from 'next/link';
import { ExternalLink, Play, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { listDictionary, removeDictionary } from '@/lib/dictionary/client';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { timestamp } from '@/lib/youtube';
import { useAccount } from './account';
import { useReview } from './use-review';
import { ReviewEntryActions } from './review-entry-actions';
import { changeReview } from '@/lib/review/client';
import { dueReviews } from '@/lib/review-scheduler';
import { vocabularyCsv, vocabularyRows } from '@/lib/export/vocabulary';
import { externalReplay } from '@/lib/dictionary/replay';

export function PersonalDictionary() {
  const account = useAccount();
  const review = useReview();
  const [deck, setDeck] = useState('all');
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
    void listDictionary()
      .then((entries) => {
        if (active) setLoaded({ userId, entries, error: '' });
      })
      .catch((reason) => {
        if (active)
          setLoaded({
            userId,
            entries: [],
            error: reason instanceof Error ? reason.message : 'Your dictionary is unavailable.',
          });
      });
    return () => {
      active = false;
    };
  }, [account.user?.id, account.user?.plan]);

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
  function exportWords() {
    const blob = new Blob(
      [
        vocabularyCsv(
          vocabularyRows(
            chosen.length ? entries.filter((e) => chosen.includes(e.id)) : visible,
            review.data,
          ),
        ),
      ],
      { type: 'text/csv;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'hibiki-words.csv';
    anchor.click();
    URL.revokeObjectURL(url);
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
            {termCount} {termCount === 1 ? 'term' : 'terms'}
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
            onClick={exportWords}
          >
            Export {chosen.length ? 'selected' : 'visible'} CSV
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
