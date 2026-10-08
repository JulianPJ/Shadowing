'use client';
import { useEffect, useState } from 'react';
import { useAccount } from './account';
import { useReview } from './use-review';
import { dictionaryPage } from '@/lib/dictionary/client';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import type { Lesson } from '@/lib/types';
import { transcriptKey } from '@/lib/transcript';
import { changeReview } from '@/lib/review/client';
export function LessonReviewRecap({ lesson }: { lesson: Lesson }) {
  const account = useAccount(),
    review = useReview();
  const [loaded, setLoaded] = useState<{ owner: string; entries: DictionaryEntry[] } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [message, setMessage] = useState('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  useEffect(() => {
    const owner = account.user?.id;
    if (!owner) return;
    let active = true;
    const load = () =>
      void transcriptKey(lesson)
        .then((key) => dictionaryPage({ lessonId: lesson.id, transcriptKey: key }))
        .then((page) => {
          if (active) {
            setLoaded({
              owner,
              entries: page.entries,
            });
            setNextCursor(page.nextCursor);
          }
        })
        .catch(() => {
          if (active) setMessage('Saved words are unavailable. You can still finish practice.');
        });
    load();
    window.addEventListener('hibiki:dictionary-change', load);
    return () => {
      active = false;
      window.removeEventListener('hibiki:dictionary-change', load);
    };
  }, [account.user?.id, lesson]);
  const entries = loaded && loaded.owner === account.user?.id ? loaded.entries : [];
  const chosen = selected.filter((id) => entries.some((e) => e.id === id));
  const enrolled = entries.filter((e) =>
    review.data.cards.some((c) => c.entryId === e.id && c.status !== 'suspended'),
  ).length;
  async function loadMore() {
    const owner = account.user?.id;
    if (!nextCursor || !owner) return;
    setLoadingMore(true);
    try {
      const key = await transcriptKey(lesson),
        page = await dictionaryPage(
          { lessonId: lesson.id, transcriptKey: key, cursor: nextCursor },
          true,
        );
      setLoaded((current) =>
        current?.owner === owner
          ? {
              owner,
              entries: [
                ...new Map([...current.entries, ...page.entries].map((e) => [e.id, e])).values(),
              ],
            }
          : current,
      );
      setNextCursor(page.nextCursor);
    } catch {
      setMessage('More saved words are unavailable. Retry when connected.');
    } finally {
      setLoadingMore(false);
    }
  }
  return (
    <section className="completion-vocabulary" aria-label="Lesson recap">
      <h3>Saved words from this lesson</h3>
      {loaded && loaded.owner === account.user?.id ? (
        <p>
          {entries.length}
          {nextCursor ? '+' : ''} saved words
          {enrolled ? ` · ${enrolled} in review` : ''}
        </p>
      ) : account.user ? (
        <p className="small muted" role="status">
          {message || 'Loading this lesson’s saved words…'}
        </p>
      ) : (
        <p className="small muted">
          Sign in to keep useful words from this lesson in your vocabulary.
        </p>
      )}
      {entries.some(
        (entry) =>
          !review.data.cards.some(
            (card) => card.entryId === entry.id && card.status !== 'suspended',
          ),
      ) ? (
        <p>Choose any saved words that you want to add to your review queue.</p>
      ) : null}
      {entries.map((e) => {
        const added = review.data.cards.some((c) => c.entryId === e.id && c.status !== 'suspended');
        return (
          <label className="review-selection" key={e.id}>
            <input
              type="checkbox"
              disabled={added}
              checked={chosen.includes(e.id)}
              onChange={(v) =>
                setSelected(
                  v.target.checked ? [...chosen, e.id] : chosen.filter((id) => id !== e.id),
                )
              }
            />
            <span lang="ja">{e.term}</span> · {e.translation}
            {added ? ' · In review' : ''}
          </label>
        );
      })}
      {!entries.length && loaded && loaded.owner === account.user?.id ? (
        <p className="small muted">
          Save a useful word from a practice sentence to keep it for later.
        </p>
      ) : null}
      {nextCursor ? (
        <button className="text-button" disabled={loadingMore} onClick={() => void loadMore()}>
          Load more lesson words
        </button>
      ) : null}
      {entries.length ? (
        <button
          className="button primary"
          disabled={!chosen.length}
          onClick={() => {
            changeReview({
              action: 'enroll',
              entryIds: chosen,
              deckId: 'inbox',
              enrolledAt: new Date().toISOString(),
            });
            setSelected([]);
            setMessage('Selected words added to review.');
          }}
        >
          Add selected words to review
        </button>
      ) : null}

      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
