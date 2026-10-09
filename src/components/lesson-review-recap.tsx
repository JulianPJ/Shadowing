'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from './account';
import { useReview } from './use-review';
import { dictionaryPage } from '@/lib/dictionary/client';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import type { Lesson } from '@/lib/types';
import { transcriptKey } from '@/lib/transcript';
import { activeCard } from '@/lib/vocabulary';

/** Words saved from this lesson; saving already put them in review. */
export function LessonReviewRecap({ lesson }: { lesson: Lesson }) {
  const account = useAccount(),
    review = useReview();
  const [loaded, setLoaded] = useState<{
    owner: string;
    entries: DictionaryEntry[];
    more: boolean;
  } | null>(null);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const owner = account.user?.id;
    if (!owner) return;
    let active = true;
    const load = () =>
      void transcriptKey(lesson)
        .then((key) => dictionaryPage({ lessonId: lesson.id, transcriptKey: key }))
        .then((page) => {
          if (active) setLoaded({ owner, entries: page.entries, more: !!page.nextCursor });
        })
        .catch(() => {
          if (active) setMessage('Saved words are unavailable right now.');
        });
    load();
    window.addEventListener('hibiki:dictionary-change', load);
    return () => {
      active = false;
      window.removeEventListener('hibiki:dictionary-change', load);
    };
  }, [account.user?.id, lesson]);
  const entries = loaded && loaded.owner === account.user?.id ? loaded.entries : [];
  const learning = entries.filter((e) => activeCard(e.id, review.data.cards)).length;
  return (
    <section className="completion-vocabulary" aria-label="Lesson recap">
      <h3>Saved words from this lesson</h3>
      {!account.user ? (
        <p className="small muted">Sign in to keep useful words from this lesson for review.</p>
      ) : !loaded ? (
        <p className="small muted" role="status">
          {message || 'Loading this lesson’s saved words…'}
        </p>
      ) : entries.length ? (
        <>
          <p>
            {entries.length}
            {loaded.more ? '+' : ''} saved {entries.length === 1 ? 'word' : 'words'}
            {learning ? ` · ${learning} in review` : ''}
          </p>
          <ul className="recap-words">
            {entries.map((e) => (
              <li key={e.id}>
                <span lang="ja">{e.term}</span> · {e.translation}
              </li>
            ))}
          </ul>
          <Link className="text-button" href="/review">
            Review your words
          </Link>
        </>
      ) : (
        <p className="small muted">Choose a word in a sentence to add it to review.</p>
      )}
    </section>
  );
}
