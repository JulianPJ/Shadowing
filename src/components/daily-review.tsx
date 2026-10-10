'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount } from './account';
import { useReview } from './use-review';
import { JapaneseText } from './japanese-text';
import { hasKanji } from '@/lib/japanese-readings';
import { VocabularyHeader } from './vocabulary-header';
import {
  acknowledgeReviewConflict,
  cachedReview,
  changeReview,
  pendingReview,
} from '@/lib/review/client';
import { dueReviews, previewReview, scheduleReview } from '@/lib/review-scheduler';
import { dictionaryByIds } from '@/lib/dictionary/client';
import { reviewContextHref, externalReplay } from '@/lib/dictionary/replay';
import { readStorage, writeStorage } from '@/lib/storage/browser';
import { studyDay } from '@/lib/study-day';
import { reviewHistory } from '@/lib/review/history';
import {
  limitStudyQueue,
  loadStudyLimits,
  saveStudyLimits,
  type StudyLimits,
} from '@/lib/review/study-settings';
import { syncStatusAfterGrade } from '@/lib/vocabulary';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import type { ReviewGrade, ReviewState } from '@/lib/review/types';
import { timestamp } from '@/lib/youtube';
const ContextPlayer = dynamic(
  () => import('./review-context-player').then((mod) => mod.ReviewContextPlayer),
  { loading: () => <p role="status">Opening context player…</p> },
);
type StudySession = {
  owner: string;
  answered: number;
  skipped: string[];
  currentId: string | null;
  startedAt: string;
  lastRating?: { previous: ReviewState; operationId: string };
};
const GRADES = ['again', 'hard', 'good', 'easy'] as const;
// Learning steps are minutes apart, so a coarse clock keeps the queue current cheaply.
const CLOCK_MS = 5000;

function laterToday(cards: ReviewState[], at: string) {
  return cards
    .filter(
      (c) =>
        c.status === 'learning' &&
        Date.parse(c.dueAt) > Date.parse(at) &&
        studyDay(c.dueAt) === studyDay(at),
    )
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.entryId.localeCompare(b.entryId));
}
function inputTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      'input, textarea, select, button, a, [contenteditable="true"], [role="textbox"]',
    )
  );
}
export function DailyReview() {
  const account = useAccount();
  const review = useReview();
  const [loaded, setLoaded] = useState<{
    owner: string;
    entries: DictionaryEntry[];
    key: string;
  } | null>(null);
  const [session, setSession] = useState<StudySession | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [reading, setReading] = useState(false);
  const [sentenceReading, setSentenceReading] = useState(false);
  const [readingsDefault, setReadingsDefault] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [error, setError] = useState('');
  const [clock, setClock] = useState(() => Date.now());
  const [retry, setRetry] = useState(0);
  const [limits, setLimits] = useState<StudyLimits>({ new: null, review: null });
  const heading = useRef<HTMLHeadingElement>(null);
  const gradeLock = useRef('');
  const owner = account.user?.id;
  const activeSession = session?.owner === owner ? session : null;
  const now = new Date(clock).toISOString();
  const cards = useMemo(
    () => review.data.cards.filter((c) => c.status !== 'suspended'),
    [review.data.cards],
  );
  // Undone ratings stay in durable history until their guarded operation syncs.
  const history = useMemo(() => {
    const undone = new Set(
      pendingReview().flatMap((op) => (op.action === 'undo' ? [op.targetOperationId] : [])),
    );
    return reviewHistory().filter((event) => !undone.has(event.operationId));
    // Both reads change only with the review data the hook already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.data, review.pending]);
  const allDue = dueReviews(cards, now);
  const limited = limitStudyQueue(cards, history, now, limits);
  const dueCards = limited.cards;
  const limitedCount = allDue.length - dueCards.length;
  const delayed = laterToday(cards, now);
  // Like Anki, learning cards due later today are shown early once nothing else is due.
  const remaining = [...dueCards, ...delayed].filter(
    (c) => !activeSession?.skipped.includes(c.entryId),
  );
  const id = activeSession?.currentId ?? (activeSession ? remaining[0]?.entryId : undefined);
  const entries = loaded && loaded.owner === owner ? loaded.entries : [];
  const entry = entries.find((e) => e.id === id);
  const card = cards.find((c) => c.entryId === id);
  const hydrationIds = [
    ...new Set([
      ...(id ? [id] : []),
      ...[...dueCards, ...delayed]
        .filter((c) => !activeSession?.skipped.includes(c.entryId))
        .slice(0, 40)
        .map((c) => c.entryId),
    ]),
  ];
  const hydrationKey = JSON.stringify(hydrationIds);
  const materialLoading =
    hydrationIds.length > 0 && (loaded?.owner !== owner || loaded?.key !== hydrationKey);
  /* Browser-only state is restored after the account has selected its storage scope. */
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!owner) return;
    const stored = readStorage<StudySession | null>('review:session', null);
    if (
      stored?.owner === owner &&
      Array.isArray(stored.skipped) &&
      Number.isInteger(stored.answered) &&
      stored.answered >= 0 &&
      typeof stored.startedAt === 'string'
    )
      setSession(stored);
    else setSession(null);
    setReadingsDefault(readStorage<boolean>('review:readings-default', false) === true);
    setLimits(loadStudyLimits());
  }, [owner]);
  useEffect(() => {
    if (owner && activeSession) writeStorage('review:session', activeSession);
  }, [owner, activeSession]);
  useEffect(() => {
    const reload = () => setLimits(loadStudyLimits());
    window.addEventListener('hibiki:sync-hydrated', reload);
    return () => window.removeEventListener('hibiki:sync-hydrated', reload);
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    setRevealed(false);
    setReading(readingsDefault);
    setSentenceReading(false);
    setContextOpen(false);
    gradeLock.current = '';
    heading.current?.focus({ preventScroll: true });
  }, [id, readingsDefault]);
  useEffect(() => {
    if (!owner || hydrationKey === '[]') return;
    let active = true;
    const ids = JSON.parse(hydrationKey) as string[];
    void dictionaryByIds(ids)
      .then((result) => {
        if (active)
          setLoaded((current) => ({
            owner,
            key: hydrationKey,
            entries: [
              ...new Map(
                [...(current?.owner === owner ? current.entries : []), ...result].map((e) => [
                  e.id,
                  e,
                ]),
              ).values(),
            ],
          }));
      })
      .catch((e) => {
        if (active) {
          setError((e as Error).message);
          setLoaded((current) => ({
            owner,
            key: hydrationKey,
            entries: current?.owner === owner ? current.entries : [],
          }));
        }
      });
    return () => {
      active = false;
    };
  }, [owner, hydrationKey, retry]);
  /* eslint-enable react-hooks/set-state-in-effect */
  function begin() {
    if (!owner) return;
    setError('');
    setSession({ owner, answered: 0, skipped: [], currentId: null, startedAt: now });
  }
  function updateLimits(value: StudyLimits) {
    setLimits(value);
    saveStudyLimits(value);
  }
  function pause() {
    setContextOpen(false);
    setSession(null);
    if (owner) writeStorage('review:session', null);
  }
  function grade(value: ReviewGrade) {
    if (!card || !entry || !activeSession || !revealed || review.conflict) return;
    const lock = `${card.entryId}:${card.revision}`;
    if (gradeLock.current === lock) return;
    gradeLock.current = lock;
    try {
      const operationId = crypto.randomUUID();
      const reviewedAt = new Date(Math.max(Date.now(), Date.parse(card.updatedAt))).toISOString();
      changeReview({
        action: 'grade',
        entryId: card.entryId,
        revision: card.revision,
        grade: value,
        reviewedAt,
        operationId,
      });
      syncStatusAfterGrade(entry, card, scheduleReview(card, value, reviewedAt));
      setSession({
        ...activeSession,
        currentId: null,
        answered: activeSession.answered + 1,
        lastRating: { previous: card, operationId },
      });
      setRevealed(false);
      setContextOpen(false);
    } catch (e) {
      gradeLock.current = '';
      setError((e as Error).message);
    }
  }
  function undo() {
    const previous = activeSession?.lastRating;
    if (!previous || !activeSession || review.conflict) return;
    const current = cachedReview().cards.find((c) => c.entryId === previous.previous.entryId);
    if (!current || current.revision !== previous.previous.revision + 1) {
      setError('This rating has changed. Refresh before correcting it.');
      return;
    }
    try {
      changeReview({
        action: 'undo',
        entryId: current.entryId,
        revision: current.revision,
        operationId: crypto.randomUUID(),
        targetOperationId: previous.operationId,
        previous: previous.previous,
        undoneAt: new Date(Math.max(Date.now(), Date.parse(current.updatedAt))).toISOString(),
      });
      setSession({
        ...activeSession,
        currentId: current.entryId,
        answered: Math.max(0, activeSession.answered - 1),
        lastRating: undefined,
      });
      setRevealed(false);
      setContextOpen(false);
      gradeLock.current = '';
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const keyboard = useRef<(event: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyboard.current = (event: KeyboardEvent) => {
      if (
        !activeSession ||
        !entry ||
        !card ||
        event.repeat ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        inputTarget(event.target)
      )
        return;
      if (event.code === 'Space' && !revealed) {
        event.preventDefault();
        setRevealed(true);
      }
      const index = ['1', '2', '3', '4'].indexOf(event.key);
      if (revealed && index >= 0) {
        event.preventDefault();
        grade(GRADES[index]);
      }
    };
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => keyboard.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const counts = {
    new: dueCards.filter((c) => c.status === 'new').length,
    learning: dueCards.filter((c) => c.status === 'learning').length,
    review: dueCards.filter((c) => c.status === 'review').length,
  };
  const skippedCount = [...dueCards, ...delayed].filter((c) =>
    activeSession?.skipped.includes(c.entryId),
  ).length;
  return (
    <main className="dictionary-screen review-screen">
      <VocabularyHeader active="review" />
      {!account.user ? (
        <section className="dictionary-empty">
          <h2>Review the words you save.</h2>
          <p>Sign in, then add words to review while you practise.</p>
          <Link className="button primary" href="/sign-in?returnTo=%2Freview">
            Sign in to review
          </Link>
        </section>
      ) : !account.user.emailVerified ? (
        <p>Verify your email before reviewing.</p>
      ) : !activeSession ? (
        <section className="dictionary-empty">
          {review.loading && !review.data.cards.length ? (
            <p role="status">Opening your review…</p>
          ) : (
            <>
              <h2>{dueCards.length} due now</h2>
              <p className="review-counts">
                {counts.new} new · {counts.learning} learning · {counts.review} review
              </p>
              {!cards.length ? (
                <p>Add a word to review while you practise, and it will appear here.</p>
              ) : !dueCards.length && !delayed.length ? (
                <p>Nothing else is due today.</p>
              ) : null}
              {delayed.length ? (
                <p>
                  {delayed.length} learning {delayed.length === 1 ? 'card is' : 'cards are'} due
                  later today.
                </p>
              ) : null}
              {limitedCount ? (
                <p>
                  {limitedCount} more {limitedCount === 1 ? 'card is' : 'cards are'} due beyond your
                  daily limit.
                </p>
              ) : null}
              <div className="review-actions">
                <button
                  className="button primary"
                  disabled={(!dueCards.length && !delayed.length) || !!review.conflict}
                  onClick={() => begin()}
                >
                  Start review
                </button>
              </div>
              <details className="review-settings">
                <summary>Review settings</summary>
                {(['new', 'review'] as const).map((kind) => (
                  <label className="review-limit-control" key={kind}>
                    {kind === 'new' ? 'New words per day' : 'Reviews per day'}
                    <input
                      type="number"
                      min={0}
                      max={10000}
                      step={1}
                      placeholder="No limit"
                      value={limits[kind] ?? ''}
                      onChange={(e) => {
                        if (e.target.value !== '' && !e.target.validity.valid) return;
                        updateLimits({
                          ...limits,
                          [kind]: e.target.value === '' ? null : Number(e.target.value),
                        });
                      }}
                    />
                  </label>
                ))}
                <p className="small muted">
                  Leave empty for no limit. Today: {limited.reviewed.new} new ·{' '}
                  {limited.reviewed.review} reviews.
                </p>
                <label className="review-reading-default">
                  <input
                    type="checkbox"
                    checked={readingsDefault}
                    onChange={(e) => {
                      setReadingsDefault(e.target.checked);
                      writeStorage('review:readings-default', e.target.checked);
                    }}
                  />
                  Show readings by default
                </label>
              </details>
            </>
          )}
        </section>
      ) : id && entry && card ? (
        <article className="dictionary-entry review-card">
          <div className="review-session-toolbar">
            <p role="status">
              {activeSession.answered} reviewed · {remaining.length} left
            </p>
            <button className="text-button" onClick={pause}>
              Pause
            </button>
          </div>
          <h2 lang="ja" tabIndex={-1} ref={heading}>
            {/* Phrase cards have no saved reading, so they show generated furigana instead. */}
            {reading && !entry.reading ? <JapaneseText text={entry.term} furigana /> : entry.term}
          </h2>
          {entry.reading || hasKanji(entry.term) ? (
            <>
              <button
                className="text-button"
                aria-expanded={reading}
                onClick={() => setReading(!reading)}
              >
                {reading ? 'Hide reading' : 'Show reading'}
              </button>
              {reading && entry.reading ? (
                <p lang="ja" className="review-reading">
                  {entry.reading}
                </p>
              ) : null}
            </>
          ) : null}
          {!revealed ? (
            <button className="button primary" onClick={() => setRevealed(true)}>
              Show answer <kbd>Space</kbd>
            </button>
          ) : (
            <div className="review-answer">
              <strong>{entry.translation}</strong>
              <p lang="ja">
                <JapaneseText text={entry.sourceSentence} furigana={sentenceReading} />
              </p>
              {entry.sourceSentenceTranslation ? <p>{entry.sourceSentenceTranslation}</p> : null}
              <div className="review-actions">
                <button
                  className="button"
                  aria-expanded={contextOpen}
                  onClick={() => setContextOpen(!contextOpen)}
                >
                  {contextOpen ? 'Hide context player' : 'Play this section'}
                </button>
                <button
                  className="text-button"
                  aria-pressed={sentenceReading}
                  onClick={() => setSentenceReading(!sentenceReading)}
                >
                  {sentenceReading ? 'Hide sentence readings' : 'Show sentence readings'}
                </button>
                <Link
                  className="text-button"
                  href={reviewContextHref(entry)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open full lesson ↗
                </Link>
                {externalReplay(entry) ? (
                  <a
                    className="text-button"
                    href={externalReplay(entry)!}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open{' '}
                    {entry.source.mediaType === 'youtube'
                      ? 'on YouTube'
                      : entry.source.mediaType === 'vimeo'
                        ? 'on Vimeo'
                        : 'source website'}{' '}
                    ↗
                  </a>
                ) : null}
              </div>
              {contextOpen ? (
                <ContextPlayer key={entry.id} entry={entry} onClose={() => setContextOpen(false)} />
              ) : null}
              <p className="small muted">
                {entry.source.lessonTitle} · {timestamp(entry.source.start)}–
                {timestamp(entry.source.end)}
              </p>
              <div className="review-grades">
                {GRADES.map((g, i) => {
                  const preview = previewReview(
                    card,
                    g,
                    new Date(Math.max(clock, Date.parse(card.updatedAt))).toISOString(),
                  );
                  return (
                    <button
                      className="button"
                      key={g}
                      disabled={!!review.conflict}
                      onClick={() => grade(g)}
                    >
                      <span>
                        {g[0].toUpperCase() + g.slice(1)} · {preview.intervalLabel}
                      </span>
                      <kbd>{i + 1}</kbd>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </article>
      ) : id ? (
        <section className="dictionary-empty" role="status">
          <h2>
            {materialLoading || review.loading
              ? 'Loading this word…'
              : 'This word isn’t available offline yet.'}
          </h2>
          {!materialLoading ? (
            <div className="review-actions">
              <button
                className="button"
                onClick={() => {
                  setError('');
                  setRetry((n) => n + 1);
                }}
              >
                Try again
              </button>
              <button
                className="text-button"
                onClick={() =>
                  setSession({
                    ...activeSession,
                    currentId: null,
                    skipped: [...activeSession.skipped, id],
                  })
                }
              >
                Skip for now
              </button>
            </div>
          ) : null}
          <button className="text-button" onClick={pause}>
            Pause
          </button>
        </section>
      ) : (
        <section className="dictionary-empty" role="status">
          <h2>
            {review.loading
              ? 'Opening your review…'
              : skippedCount || limitedCount
                ? 'Caught up for now'
                : 'Today’s review is complete'}
          </h2>
          <p>
            {activeSession.answered} {activeSession.answered === 1 ? 'word' : 'words'} reviewed.
          </p>
          <div className="review-actions">
            {skippedCount ? (
              <button
                className="button"
                onClick={() => {
                  setSession({ ...activeSession, skipped: [], currentId: null });
                  setRetry((n) => n + 1);
                }}
              >
                Retry skipped words
              </button>
            ) : null}
            <button className="button" onClick={pause}>
              Done
            </button>
            <Link className="text-button" href="/">
              Back to practice
            </Link>
          </div>
        </section>
      )}
      {activeSession?.lastRating && (!entry || !card || revealed) ? (
        <button className="button review-undo" disabled={!!review.conflict} onClick={undo}>
          Undo last rating
        </button>
      ) : null}
      {review.conflict ? (
        <section className="review-notice" role="alert">
          <p>{review.conflict}</p>
          <button
            className="button"
            onClick={() => {
              acknowledgeReviewConflict();
              pause();
            }}
          >
            Use latest schedule
          </button>
        </section>
      ) : null}
      {error || review.error ? (
        <div className="review-notice" role="alert">
          <p>{error || review.error}</p>
          <button
            className="text-button"
            onClick={() =>
              void review
                .refresh()
                .then(() => {
                  setError('');
                  setRetry((n) => n + 1);
                })
                .catch((e) => setError((e as Error).message))
            }
          >
            Try again
          </button>
        </div>
      ) : null}
    </main>
  );
}
