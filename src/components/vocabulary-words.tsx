'use client';
import Link from 'next/link';
import { ExternalLink, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { dictionaryPage, listDictionary, removeDictionary } from '@/lib/dictionary/client';
import { cachedDictionary } from '@/lib/dictionary/cache';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { externalReplay, reviewContextHref } from '@/lib/dictionary/replay';
import { vocabularyCsv, vocabularyRows, vocabularyTsv } from '@/lib/export/vocabulary';
import { markWords } from '@/lib/knowledge/client';
import type { WordState } from '@/lib/knowledge/types';
import { activeCard, learnWord, markWordKnown } from '@/lib/vocabulary';
import { timestamp } from '@/lib/youtube';
import { authPath } from '@/lib/auth/return-path';
import { useAccount } from './account';
import { useReview } from './use-review';
import { useWordKnowledge } from './use-word-knowledge';
import { VocabularyHeader } from './vocabulary-header';

type Filter = 'all' | 'learning' | 'known';
const MARKED_PAGE = 100;

export function VocabularyWords() {
  const account = useAccount();
  return (
    <main className="dictionary-screen">
      <VocabularyHeader active="words" />
      {account.user ? (
        <SavedWords key={account.user.id} />
      ) : (
        <section className="dictionary-empty">
          <h2>Keep words with their sentence.</h2>
          <p>
            Choose a word while you practise to look it up. Sign in to save it with its sentence and
            review it here.
          </p>
          <Link className="button primary" href={authPath('/sign-in', '/words')}>
            Sign in
          </Link>
        </section>
      )}
      <MarkedWords />
    </main>
  );
}

function SavedWords() {
  const account = useAccount();
  const review = useReview();
  const [filter, setFilter] = useState<Filter>('all');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{
    key: string;
    entries: DictionaryEntry[];
    error: string;
  }>();
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const generation = useRef(0);
  const queryKey = JSON.stringify({ search, attempt });
  useEffect(() => {
    let active = true;
    const load = () => {
      const ticket = ++generation.current;
      void dictionaryPage(search ? { search } : {})
        .then((page) => {
          if (!active || ticket !== generation.current) return;
          setLoaded({ key: queryKey, entries: page.entries, error: '' });
          setNextCursor(page.nextCursor);
          setOffline(!!page.offline);
        })
        .catch((reason) => {
          if (active && ticket === generation.current)
            setLoaded({
              key: queryKey,
              entries: [],
              error: reason instanceof Error ? reason.message : 'Your words are unavailable.',
            });
        });
    };
    load();
    window.addEventListener('hibiki:dictionary-change', load);
    return () => {
      active = false;
      window.removeEventListener('hibiki:dictionary-change', load);
    };
  }, [search, queryKey]);
  const ready = loaded?.key === queryKey;
  const entries = ready ? loaded.entries : [];
  const learning = (entry: DictionaryEntry) => !!activeCard(entry.id, review.data.cards);
  const visible = entries.filter(
    (entry) => filter === 'all' || (filter === 'learning') === learning(entry),
  );
  async function loadMore() {
    if (!nextCursor || busy) return;
    const ticket = generation.current;
    setBusy(true);
    try {
      const page = await dictionaryPage(
        { ...(search ? { search } : {}), cursor: nextCursor },
        true,
      );
      if (ticket !== generation.current) return;
      setLoaded((current) =>
        current
          ? {
              ...current,
              entries: [
                ...new Map([...current.entries, ...page.entries].map((e) => [e.id, e])).values(),
              ],
            }
          : current,
      );
      setNextCursor(page.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more words.');
    } finally {
      setBusy(false);
    }
  }
  async function exportWords(format: 'csv' | 'tsv') {
    setBusy(true);
    setError('');
    try {
      const values = await listDictionary(search ? { search } : {});
      const rows = vocabularyRows(values);
      const blob = new Blob([format === 'csv' ? vocabularyCsv(rows) : vocabularyTsv(rows)], {
        type:
          format === 'csv' ? 'text/csv;charset=utf-8' : 'text/tab-separated-values;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'hibiki-words.' + format;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice(`Exported ${values.length} ${values.length === 1 ? 'word' : 'words'}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not export your words.');
    } finally {
      setBusy(false);
    }
  }
  async function remove(entry: DictionaryEntry) {
    if (!window.confirm(`Delete “${entry.term}” and its review card?`)) return;
    setError('');
    try {
      await removeDictionary(entry.id);
      setLoaded((current) =>
        current
          ? { ...current, entries: current.entries.filter((e) => e.id !== entry.id) }
          : current,
      );
      setNotice(`Deleted ${entry.term}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete this word.');
    }
  }
  function act(action: () => void) {
    setError('');
    try {
      action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this word.');
    }
  }
  return (
    <section className="saved-words" aria-label="Saved words">
      <div className="saved-words-filters">
        <form
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(term.trim());
          }}
        >
          <label>
            Search your words
            <input
              value={term}
              maxLength={120}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Japanese, reading or meaning"
            />
          </label>
          <button className="button small-button">Search</button>
        </form>
        <div className="library-filters" role="group" aria-label="Filter words">
          {(
            [
              ['all', 'All'],
              ['learning', 'Learning'],
              ['known', 'Known'],
            ] as const
          ).map(([value, label]) => (
            <button key={value} aria-pressed={filter === value} onClick={() => setFilter(value)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {!ready ? (
        <p role="status">Opening your words…</p>
      ) : loaded.error ? (
        <div className="dictionary-empty">
          <p role="alert">{loaded.error}</p>
          <button className="button" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      ) : visible.length ? (
        <div className="dictionary-list">
          {visible.map((entry) => {
            const external = externalReplay(entry);
            const inReview = learning(entry);
            return (
              <article className="dictionary-entry" key={entry.id}>
                <div className="dictionary-entry-term">
                  <div>
                    <h2 lang="ja">{entry.term}</h2>
                    {entry.reading ? <span lang="ja">{entry.reading}</span> : null}
                  </div>
                  <strong>{entry.translation}</strong>
                  <span className={`word-status ${inReview ? 'in-review' : ''}`}>
                    {inReview ? 'Learning' : 'Known'}
                  </span>
                </div>
                <div className="dictionary-entry-context">
                  <p lang="ja">{entry.sourceSentence}</p>
                  {entry.sourceSentenceTranslation ? (
                    <p>{entry.sourceSentenceTranslation}</p>
                  ) : null}
                </div>
                <div className="dictionary-entry-source">
                  <span>
                    {entry.source.lessonTitle} · {timestamp(entry.source.start)}
                  </span>
                  <div>
                    <Link className="button small-button" href={reviewContextHref(entry)}>
                      <Play size={14} />
                      Open section
                    </Link>
                    {inReview ? (
                      <button
                        className="button small-button"
                        onClick={() => act(() => markWordKnown(entry))}
                      >
                        Mark known
                      </button>
                    ) : (
                      <button
                        className="button small-button"
                        onClick={() => act(() => learnWord(entry))}
                      >
                        Learn again
                      </button>
                    )}
                    {external ? (
                      <a className="text-button" href={external} target="_blank" rel="noreferrer">
                        {entry.source.mediaType === 'youtube'
                          ? 'Open on YouTube'
                          : entry.source.mediaType === 'vimeo'
                            ? 'Open on Vimeo'
                            : 'Open source media'}{' '}
                        <ExternalLink size={14} />
                      </a>
                    ) : null}
                    <button
                      className="icon-button dictionary-remove"
                      aria-label={`Delete ${entry.term}`}
                      onClick={() => void remove(entry)}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="dictionary-empty">
          <h2>
            {search || filter !== 'all'
              ? 'No words match.'
              : offline
                ? 'No saved words are available offline.'
                : 'No saved words yet.'}
          </h2>
          <p>
            {search || filter !== 'all'
              ? 'Try another search or show all words.'
              : 'While you practise, choose a word in the sentence and add it to review.'}
          </p>
          {search || filter !== 'all' ? (
            <button
              className="button"
              onClick={() => {
                setTerm('');
                setSearch('');
                setFilter('all');
              }}
            >
              Show all words
            </button>
          ) : (
            <Link className="button primary" href="/practice/demo">
              Try it in the demo
            </Link>
          )}
        </div>
      )}
      {nextCursor && ready ? (
        <button className="button" disabled={busy} onClick={() => void loadMore()}>
          {busy ? 'Loading…' : 'Load more words'}
        </button>
      ) : null}
      {entries.length ? (
        <details className="collection-export">
          <summary>Export words</summary>
          <div className="collection-bulk-actions">
            <button className="text-button" disabled={busy} onClick={() => void exportWords('csv')}>
              Export CSV
            </button>
            <button className="text-button" disabled={busy} onClick={() => void exportWords('tsv')}>
              Export TSV (Anki)
            </button>
          </div>
        </details>
      ) : null}
      {offline ? <p role="status">Showing words saved on this device.</p> : null}
      {notice ? (
        <p className="collection-notice" role="status">
          {notice}
        </p>
      ) : null}
      {error || review.conflict ? (
        <p className="dictionary-page-error" role="alert">
          {error || review.conflict}
        </p>
      ) : null}
      {account.user && !account.user.emailVerified ? (
        <p role="status">Verify your email to save and review words.</p>
      ) : null}
    </section>
  );
}

const stateLabels: Record<WordState, string> = {
  unknown: 'Unmarked',
  learning: 'Learning',
  known: 'Known',
  ignored: 'Ignored',
};

/** Words marked Known, Learning or Ignored that have no saved sentence. Works without an account. */
function MarkedWords() {
  const { states } = useWordKnowledge();
  const [limit, setLimit] = useState(MARKED_PAGE);
  const saved = useMemo(
    () => new Set(Object.values(cachedDictionary().records).map((r) => r.entry.term)),
    // Recompute when knowledge changes; saved words share the same refresh cadence.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [states],
  );
  const marked = Object.values(states)
    .filter((record) => record.state !== 'unknown' && !saved.has(record.lemma))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  if (!marked.length) return null;
  return (
    <section className="marked-words" aria-labelledby="marked-words-title">
      <h2 id="marked-words-title">Other words you’ve marked</h2>
      <p className="small muted">
        Marks change word highlighting and vocabulary coverage in every lesson.
      </p>
      <ul className="marked-word-list">
        {marked.slice(0, limit).map((record) => (
          <li key={record.lemma}>
            <span lang="ja">{record.lemma}</span>
            {record.reading ? (
              <span className="small muted" lang="ja">
                {record.reading}
              </span>
            ) : null}
            <label>
              <span className="sr-only">Status for {record.lemma}</span>
              <select
                value={record.state}
                onChange={(event) => markWords([record], event.target.value as WordState)}
              >
                {(Object.keys(stateLabels) as WordState[]).map((state) => (
                  <option key={state} value={state}>
                    {stateLabels[state]}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
      </ul>
      {marked.length > limit ? (
        <button className="text-button" onClick={() => setLimit((value) => value + MARKED_PAGE)}>
          Show more
        </button>
      ) : null}
    </section>
  );
}
