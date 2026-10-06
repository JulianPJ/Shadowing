'use client';
import Link from 'next/link';
import { ExternalLink, Play, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { listDictionary, removeDictionary } from '@/lib/dictionary/client';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { timestamp } from '@/lib/youtube';
import { useAccount } from './account';

function externalReplay(entry: DictionaryEntry) {
  const url = entry.source.mediaUrl;
  if (!url) return null;
  if (entry.source.mediaType === 'youtube')
    return `${url}&t=${Math.max(0, Math.floor(entry.source.start))}s`;
  if (entry.source.mediaType === 'vimeo')
    return `${url}#t=${Math.max(0, Math.floor(entry.source.start))}s`;
  if (entry.source.mediaType === 'direct')
    return `${url}#t=${Math.max(0, entry.source.start)}`;
  return url;
}

export function PersonalDictionary() {
  const account = useAccount();
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
  }, [account.user?.id]);

  const entries =
    account.user && loaded?.userId === account.user.id ? loaded.entries : [];
  const loading = Boolean(account.user && loaded?.userId !== account.user.id);
  const error =
    actionError || (account.user && loaded?.userId === account.user.id ? loaded.error : '');

  const termCount = useMemo(
    () => new Set(entries.map((entry) => entry.normalizedTerm)).size,
    [entries],
  );

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
          <span className="dictionary-count">{termCount} {termCount === 1 ? 'term' : 'terms'}</span>
        ) : null}
      </div>
      {!account.user ? (
        <section className="dictionary-empty">
          <h2>Keep vocabulary with its context.</h2>
          <p>
            Sign in, then click a word or select a phrase in a practice sentence to save its
            meaning and source section here.
          </p>
          <Link className="button primary" href="/sign-in">
            Sign in
          </Link>
        </section>
      ) : loading ? (
        <p role="status">Opening your dictionary…</p>
      ) : entries.length ? (
        <div className="dictionary-list">
          {entries.map((entry) => {
            const external = externalReplay(entry);
            return (
              <article className="dictionary-entry" key={entry.id}>
                <div className="dictionary-entry-term">
                  <div>
                    <h2 lang="ja">{entry.term}</h2>
                    {entry.reading ? <span lang="ja">{entry.reading}</span> : null}
                  </div>
                  <strong>{entry.translation}</strong>
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
      {error ? <p className="dictionary-page-error" role="alert">{error}</p> : null}
      <p className="dictionary-future small muted">
        Today this is a simple account-backed list. The record IDs and source metadata are designed
        so decks and spaced-repetition review state can be layered on later without rewriting saved
        vocabulary.
      </p>
    </main>
  );
}
