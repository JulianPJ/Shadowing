'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from './account';
import { useReview } from './use-review';
import { listDictionary } from '@/lib/dictionary/client';
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
  useEffect(() => {
    const owner = account.user?.id;
    if (!owner) return;
    let active = true;
    const load = () =>
      void Promise.all([listDictionary(), transcriptKey(lesson)])
        .then(([entries, key]) => {
          if (active)
            setLoaded({
              owner,
              entries: entries.filter(
                (e) => e.source.lessonId === lesson.id && e.source.transcriptKey === key,
              ),
            });
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
  return (
    <section className="topic-vocabulary-card" aria-label="Lesson recap">
      <span className="eyebrow">KEEP WHAT YOU LEARNED</span>
      <h2>Lesson recap</h2>
      <p>
        {lesson.segments.length} sections completed · {entries.length} saved words
      </p>
      <p>
        Choose words from this lesson for a short review later. Topic vocabulary, your Shadowing
        Match summary and comprehension check remain available alongside this recap.
      </p>
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
      {!entries.length ? (
        <p className="small muted">
          Save useful words from a practice sentence or the topic vocabulary lookup. Saved words
          will appear here.
        </p>
      ) : null}
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
      <Link className="text-button" href="/review">
        Daily Review
      </Link>
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
