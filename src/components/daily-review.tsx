'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount } from './account';
import { useReview } from './use-review';
import { changeReview } from '@/lib/review/client';
import { dueReviews } from '@/lib/review-scheduler';
import { dictionaryByIds } from '@/lib/dictionary/client';
import { reviewContextHref, externalReplay } from '@/lib/dictionary/replay';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import type { ReviewGrade } from '@/lib/review/types';
import { timestamp } from '@/lib/youtube';
export function DailyReview() {
  const account = useAccount();
  const review = useReview();
  const [loaded, setLoaded] = useState<{ owner: string; entries: DictionaryEntry[] } | null>(null);
  const [session, setSession] = useState<{ owner: string; ids: string[]; index: number } | null>(
    null,
  );
  const [revealed, setRevealed] = useState(false);
  const [error, setError] = useState('');
  const [deck, setDeck] = useState('all');
  const dueCards = dueReviews(review.data.cards, new Date().toISOString()).filter(
    (c) =>
      deck === 'all' ||
      review.data.memberships.some((m) => m.entryId === c.entryId && m.deckId === deck),
  );
  const hydrationIds = [
    ...new Set([
      ...(session && session.owner === account.user?.id ? session.ids : []),
      ...dueCards.slice(0, 20).map((c) => c.entryId),
    ]),
  ];
  const hydrationKey = JSON.stringify(hydrationIds);
  useEffect(() => {
    const owner = account.user?.id;
    if (!owner) return;
    let active = true;
    const ids = JSON.parse(hydrationKey) as string[];
    if (!ids.length) return;
    void dictionaryByIds(ids)
      .then((entries) => {
        if (active)
          setLoaded((current) => ({
            owner,
            entries: [
              ...new Map(
                [...(current?.owner === owner ? current.entries : []), ...entries].map((e) => [
                  e.id,
                  e,
                ]),
              ).values(),
            ],
          }));
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [account.user?.id, hydrationKey]);
  const entries = loaded && loaded.owner === account.user?.id ? loaded.entries : [];
  const due = dueCards.filter((c) => entries.some((e) => e.id === c.entryId));
  const activeSession = session?.owner === account.user?.id ? session : null;
  const id = activeSession?.ids[activeSession.index];
  const entry = entries.find((e) => e.id === id);
  const card = review.data.cards.find((c) => c.entryId === id);
  const complete = !!activeSession && activeSession.index >= activeSession.ids.length;
  function grade(value: ReviewGrade) {
    if (!card || !activeSession) return;
    try {
      changeReview({
        action: 'grade',
        entryId: card.entryId,
        revision: card.revision,
        grade: value,
        reviewedAt: new Date().toISOString(),
        operationId: crypto.randomUUID(),
      });
      setSession({ ...activeSession, index: activeSession.index + 1 });
      setRevealed(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <main className="dictionary-screen review-screen">
      <Link href="/" className="eyebrow">
        HIBIKI
      </Link>
      <h1>Daily Review</h1>
      <p>Recall a little Japanese, with the context that made it useful.</p>
      {!account.user ? (
        <Link className="button primary" href="/sign-in">
          Sign in to review
        </Link>
      ) : !account.user.emailVerified ? (
        <p>Verify your email before reviewing.</p>
      ) : (
        <>
          {!activeSession ? (
            <section className="dictionary-empty">
              <label>
                Review deck{' '}
                <select value={deck} onChange={(e) => setDeck(e.target.value)}>
                  <option value="all">All decks</option>
                  {review.data.decks.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </label>
              <h2>
                {dueCards.length} due · ~
                {Math.max(1, Math.ceil(Math.min(dueCards.length, 20) * 0.25))} min
              </h2>
              <p>Up to 20 words per session. You choose what enters review.</p>
              {dueCards.length && due.length < Math.min(20, dueCards.length) ? (
                <p role="status">
                  Loading review material. Offline sessions use words already cached on this device.
                </p>
              ) : null}
              <button
                className="button primary"
                disabled={!due.length}
                onClick={() =>
                  setSession({
                    owner: account.user!.id,
                    ids: due.slice(0, 20).map((c) => c.entryId),
                    index: 0,
                  })
                }
              >
                Start review
              </button>
              <Link className="text-button" href="/dictionary">
                Choose words in My Words
              </Link>
            </section>
          ) : complete ? (
            <section className="dictionary-empty" role="status">
              <h2>Review complete</h2>
              <p>
                You reviewed {activeSession.index} {activeSession.index === 1 ? 'word' : 'words'}.
                Again answers return in 10 minutes.
              </p>
              <Link className="button primary" href="/">
                Back to practice
              </Link>
              <button className="text-button" onClick={() => setSession(null)}>
                View remaining reviews
              </button>
            </section>
          ) : entry && card ? (
            <article className="dictionary-entry review-card">
              <p className="small muted">
                {activeSession!.index + 1} of {activeSession!.ids.length}
              </p>
              <h2 lang="ja">{entry.term}</h2>
              {entry.reading ? <p lang="ja">{entry.reading}</p> : null}
              {!revealed ? (
                <>
                  <p>Recall the meaning.</p>
                  <button className="button primary" onClick={() => setRevealed(true)}>
                    Reveal answer
                  </button>
                </>
              ) : (
                <>
                  <strong>{entry.translation}</strong>
                  <p lang="ja">{entry.sourceSentence}</p>
                  <p>{entry.sourceSentenceTranslation}</p>
                  <p className="small muted">
                    {entry.source.lessonTitle} · {timestamp(entry.source.start)}–
                    {timestamp(entry.source.end)}
                  </p>
                  <Link
                    className="button small-button"
                    href={reviewContextHref(entry)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Play in context
                  </Link>
                  {externalReplay(entry) ? (
                    <a
                      className="text-button"
                      href={externalReplay(entry)!}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Source video
                    </a>
                  ) : null}
                  <p className="small muted">
                    Context opens the existing practice player in a new tab. Private or local media
                    may need reattaching.
                  </p>
                  <div className="review-grades">
                    {(['again', 'hard', 'good', 'easy'] as const).map((g) => (
                      <button className="button" key={g} onClick={() => grade(g)}>
                        {g[0].toUpperCase() + g.slice(1)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </article>
          ) : (
            <p role="status">
              This word is no longer available.{' '}
              <button
                className="text-button"
                onClick={() => {
                  if (activeSession)
                    setSession({ ...activeSession, index: activeSession.index + 1 });
                }}
              >
                Skip word
              </button>
            </p>
          )}
          {review.pending ? (
            <p role="status">{review.pending} changes saved on this device · waiting to sync</p>
          ) : null}
          {review.conflict ? <p role="alert">{review.conflict}</p> : null}
          {error || review.error ? (
            <p role="alert">
              {error || review.error}{' '}
              <button
                className="text-button"
                onClick={() =>
                  void review
                    .refresh()
                    .then(() => setError(''))
                    .catch((e) => setError((e as Error).message))
                }
              >
                Retry sync
              </button>
            </p>
          ) : null}
        </>
      )}
    </main>
  );
}
