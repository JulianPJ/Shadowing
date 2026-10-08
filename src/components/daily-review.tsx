'use client';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useAccount } from './account';
import { useReview } from './use-review';
import { StandaloneNavigation } from './chrome';
import { JapaneseText } from './japanese-text';
import {
  acknowledgeReviewConflict,
  cachedReview,
  changeReview,
  pendingReview,
} from '@/lib/review/client';
import { dueReviews, previewReview, reviewIntervalLabel } from '@/lib/review-scheduler';
import { dictionaryByIds } from '@/lib/dictionary/client';
import { reviewContextHref, externalReplay } from '@/lib/dictionary/replay';
import { readStorage, writeStorage, storageAccount } from '@/lib/storage/browser';
import { studyDay, studyTimeZone } from '@/lib/study-day';
import { reviewHistory } from '@/lib/review/history';
import {
  loadStudySettings,
  saveStudySettings,
  limitDeckStudyQueue,
  type StudySettings,
  type StudyLimits,
} from '@/lib/review/study-settings';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import type { ReviewGrade, ReviewState } from '@/lib/review/types';
import { timestamp } from '@/lib/youtube';
const ContextPlayer = dynamic(
  () => import('./review-context-player').then((mod) => mod.ReviewContextPlayer),
  { loading: () => <p role="status">Opening context player…</p> },
);
type StudySession = {
  owner: string;
  deck: string;
  ahead: boolean;
  answered: number;
  skipped: string[];
  currentId: string | null;
  startedAt: string;
  lastRating?: { previous: ReviewState; operationId: string };
};
function eligible(
  cards: ReviewState[],
  memberships: { entryId: string; deckId: string }[],
  deck: string,
) {
  return cards.filter(
    (c) =>
      c.status !== 'suspended' &&
      (deck === 'all' || memberships.some((m) => m.entryId === c.entryId && m.deckId === deck)),
  );
}
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
  const [deck, setDeck] = useState('all');
  const [clock, setClock] = useState(() => Date.now());
  const [retry, setRetry] = useState(0);
  const [settings, setSettings] = useState<StudySettings>({
    defaults: { new: null, review: null },
    decks: {},
    extensions: {},
  });
  const heading = useRef<HTMLHeadingElement>(null);
  const gradeLock = useRef('');
  const owner = account.user?.id;
  const activeSession = session?.owner === owner ? session : null;
  const selectedDeck = activeSession?.deck ?? deck;
  const now = new Date(clock).toISOString();
  const cards = eligible(review.data.cards, review.data.memberships, selectedDeck);
  const allDueCards = dueReviews(cards, now);
  const configuredLimits = settings.decks[selectedDeck] ?? settings.defaults;
  // Offline undo is immediate; durable history remains until its guarded operation syncs.
  const pendingUndos = new Set(
    pendingReview().flatMap((op) => (op.action === 'undo' ? [op.targetOperationId] : [])),
  );
  const history = reviewHistory().filter((event) => !pendingUndos.has(event.operationId));
  const limited = limitDeckStudyQueue(
    cards,
    review.data.memberships,
    history,
    now,
    settings,
    selectedDeck,
  );
  const dueCards = limited.cards;
  const limitedCount = allDueCards.length - dueCards.length;
  const delayed = laterToday(cards, now);
  const remaining = [...dueCards, ...(activeSession?.ahead ? delayed : [])].filter(
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
    const requested = new URLSearchParams(window.location.search).get('deck');
    if (requested && /^[\w-]{1,100}$/.test(requested)) setDeck(requested);
    if (
      stored?.owner === owner &&
      Array.isArray(stored.skipped) &&
      Number.isInteger(stored.answered) &&
      stored.answered >= 0 &&
      typeof stored.deck === 'string' &&
      typeof stored.ahead === 'boolean' &&
      typeof stored.startedAt === 'string' &&
      (!requested || requested === stored.deck)
    ) {
      setSession(stored);
      setDeck(stored.deck);
    } else setSession(null);
    setReadingsDefault(readStorage<boolean>('review:readings-default', false) === true);
    setSettings(loadStudySettings());
  }, [owner]);
  useEffect(() => {
    if (owner && activeSession) writeStorage('review:session', activeSession);
  }, [owner, activeSession]);
  useEffect(() => {
    const reload = () => {
      if (owner && owner === storageAccount()) {
        const next = loadStudySettings();
        setSettings((current) =>
          JSON.stringify(current) === JSON.stringify(next) ? current : next,
        );
      }
    };
    const local = (event: Event) => {
      if ((event as CustomEvent<{ key: string }>).detail?.key === 'preferences') reload();
    };
    const cross = (event: StorageEvent) => {
      if (event.key?.endsWith(':preferences')) reload();
    };
    window.addEventListener('hibiki:sync-hydrated', reload);
    window.addEventListener('hibiki:local-write', local);
    window.addEventListener('storage', cross);
    return () => {
      window.removeEventListener('hibiki:sync-hydrated', reload);
      window.removeEventListener('hibiki:local-write', local);
      window.removeEventListener('storage', cross);
    };
  }, [owner]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
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
  function begin(ahead = false) {
    if (!owner) return;
    setError('');
    setSession({
      owner,
      deck,
      ahead,
      answered: 0,
      skipped: [],
      currentId: null,
      startedAt: now,
    });
  }
  function updateLimits(value: StudyLimits) {
    const updated =
      selectedDeck === 'all'
        ? { ...settings, defaults: value }
        : { ...settings, decks: { ...settings.decks, [selectedDeck]: value } };
    setSettings(updated);
    saveStudySettings(updated);
  }
  function extendToday() {
    const updated = {
      ...settings,
      extensions: { ...settings.extensions, [selectedDeck]: studyDay(now) },
    };
    setSettings(updated);
    saveStudySettings(updated);
    if (!activeSession) begin();
  }
  function pause() {
    setContextOpen(false);
    setSession(null);
    if (owner) writeStorage('review:session', null);
  }
  function grade(value: ReviewGrade) {
    if (!card || !activeSession || !revealed || review.conflict) return;
    const lock = `${card.entryId}:${card.revision}`;
    if (gradeLock.current === lock) return;
    gradeLock.current = lock;
    try {
      const operationId = crypto.randomUUID();
      changeReview({
        action: 'grade',
        entryId: card.entryId,
        revision: card.revision,
        grade: value,
        reviewedAt: new Date(Math.max(clock, Date.parse(card.updatedAt))).toISOString(),
        operationId,
      });
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
        undoneAt: new Date(Math.max(clock, Date.parse(current.updatedAt))).toISOString(),
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
  useEffect(() => {
    function keydown(event: KeyboardEvent) {
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
        grade((['again', 'hard', 'good', 'easy'] as const)[index]);
      }
    }
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  });
  const newCount = dueCards.filter((c) => c.status === 'new').length;
  const learningCount = dueCards.filter((c) => c.status === 'learning').length;
  const reviewCount = dueCards.filter((c) => c.status === 'review').length;
  const skippedCount = dueCards.filter((c) => activeSession?.skipped.includes(c.entryId)).length;
  const upcoming = cards
    .filter((c) => c.status === 'learning' && Date.parse(c.dueAt) > clock)
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt))[0];
  return (
    <>
      <StandaloneNavigation vocabularyView="review" />
      <main className="dictionary-screen review-screen">
        <h1>Daily Review</h1>
        <p>Recall Japanese, then replay the context that made it useful.</p>
        {!account.user ? (
          <Link className="button primary" href="/sign-in?returnTo=%2Freview">
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
                {review.loading && !review.data.cards.length ? (
                  <p role="status">Opening your review schedule…</p>
                ) : (
                  <>
                    <h2>{dueCards.length} due now</h2>
                    <p className="review-counts">
                      {newCount} new · {learningCount} learning · {reviewCount} review
                    </p>
                    <p>
                      Study the full due queue. Learning cards return when ready; there is no
                      20-word cutoff.
                    </p>
                    {delayed.length ? (
                      <p>
                        {delayed.length} learning {delayed.length === 1 ? 'card is' : 'cards are'}{' '}
                        due later today.
                      </p>
                    ) : null}
                    {!cards.length ? (
                      <p>Save a word with “Save and study”, or add saved words to review.</p>
                    ) : !dueCards.length && !delayed.length && !limitedCount ? (
                      <p>
                        Nothing else is due today. Keep practising; your next scheduled cards stay
                        saved.
                      </p>
                    ) : null}
                    {limitedCount ? (
                      <p>
                        {limitedCount} more {limitedCount === 1 ? 'card is' : 'cards are'} due
                        beyond your daily limits.{' '}
                        <button className="text-button" onClick={extendToday}>
                          Study all due today
                        </button>
                      </p>
                    ) : null}
                    <div className="review-actions">
                      <button
                        className="button primary"
                        disabled={!dueCards.length || !!review.conflict}
                        onClick={() => begin()}
                      >
                        Start review
                      </button>
                      {delayed.length ? (
                        <button
                          className="button"
                          disabled={!!review.conflict}
                          onClick={() => begin(true)}
                        >
                          Study remaining today now
                        </button>
                      ) : null}
                      <Link className="text-button" href="/dictionary?view=decks">
                        Browse decks
                      </Link>
                    </div>
                    <label className="review-reading-default">
                      <input
                        type="checkbox"
                        checked={readingsDefault}
                        onChange={(e) => {
                          setReadingsDefault(e.target.checked);
                          writeStorage('review:readings-default', e.target.checked);
                        }}
                      />
                      Show term readings by default on this device
                    </label>
                    <details className="review-settings">
                      <summary>Daily limits</summary>
                      <p>
                        {selectedDeck === 'all'
                          ? 'Shared defaults for your decks.'
                          : 'Overrides for this deck.'}{' '}
                        Learning retries are always available. Limits and accepted ratings sync with
                        your account; offline ratings here count immediately. Today-only extensions
                        stay on this device.
                      </p>
                      <p>
                        Today: {limited.reviewed.new} new · {limited.reviewed.review} review cards.
                      </p>
                      <p className="small muted">
                        Leave a field empty for no limit. Set it to 0 to pause that card type.
                      </p>
                      {(['new', 'review'] as const).map((kind) => (
                        <div className="review-limit-control" key={kind}>
                          <label>
                            Daily {kind} card limit
                            <input
                              type="number"
                              min={0}
                              max={10000}
                              step={1}
                              placeholder="No limit"
                              value={configuredLimits[kind] ?? ''}
                              onChange={(e) => {
                                if (e.target.value !== '' && !e.target.validity.valid) return;
                                updateLimits({
                                  ...configuredLimits,
                                  [kind]: e.target.value === '' ? null : Number(e.target.value),
                                });
                              }}
                            />
                          </label>
                          <button
                            className="text-button"
                            aria-label={`No limit for ${kind} cards`}
                            disabled={configuredLimits[kind] === null}
                            onClick={() => updateLimits({ ...configuredLimits, [kind]: null })}
                          >
                            No limit
                          </button>
                        </div>
                      ))}
                      {selectedDeck !== 'all' && settings.decks[selectedDeck] ? (
                        <button
                          className="text-button"
                          onClick={() => {
                            const updated = { ...settings, decks: { ...settings.decks } };
                            delete updated.decks[selectedDeck];
                            setSettings(updated);
                            saveStudySettings(updated);
                          }}
                        >
                          Use shared defaults
                        </button>
                      ) : null}
                    </details>
                    <p className="small muted">
                      Today follows {studyTimeZone()}. “Study remaining today now” brings forward
                      learning steps only.
                    </p>
                  </>
                )}
              </section>
            ) : id && entry && card ? (
              <article className="dictionary-entry review-card">
                <div className="review-session-toolbar">
                  <p role="status">
                    {activeSession.answered} ratings · {dueCards.length} due now · {delayed.length}{' '}
                    learning later today
                  </p>
                  {revealed ? (
                    <button className="text-button" onClick={pause}>
                      Pause study
                    </button>
                  ) : null}
                </div>
                <h2 lang="ja" tabIndex={-1} ref={heading}>
                  {entry.term}
                </h2>
                {entry.reading ? (
                  <>
                    <button
                      className="text-button"
                      aria-expanded={reading}
                      onClick={() => setReading(!reading)}
                    >
                      {reading ? 'Hide furigana' : 'Show furigana'}
                    </button>
                    {reading ? (
                      <p lang="ja" className="review-reading">
                        {entry.reading}
                      </p>
                    ) : null}
                  </>
                ) : null}
                {!revealed ? (
                  <>
                    <p>Recall the meaning before revealing.</p>
                    <button className="button primary" onClick={() => setRevealed(true)}>
                      Show answer <kbd>Space</kbd>
                    </button>
                  </>
                ) : (
                  <div className="review-answer">
                    <div className="review-actions">
                      <button
                        className="button"
                        aria-expanded={contextOpen}
                        onClick={() => setContextOpen(!contextOpen)}
                      >
                        {contextOpen ? 'Hide context player' : 'Play this section'}
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
                      <ContextPlayer
                        key={entry.id}
                        entry={entry}
                        onClose={() => setContextOpen(false)}
                      />
                    ) : null}
                    <strong>{entry.translation}</strong>
                    <p lang="ja">
                      <JapaneseText text={entry.sourceSentence} furigana={sentenceReading} />
                    </p>
                    <button
                      className="text-button"
                      aria-pressed={sentenceReading}
                      onClick={() => setSentenceReading(!sentenceReading)}
                    >
                      {sentenceReading ? 'Hide sentence readings' : 'Show sentence readings'}
                    </button>
                    {entry.sourceSentenceTranslation ? (
                      <p>{entry.sourceSentenceTranslation}</p>
                    ) : (
                      <p className="small muted">Sentence translation has not been saved.</p>
                    )}
                    <p className="small muted">
                      {entry.source.lessonTitle} · {timestamp(entry.source.start)}–
                      {timestamp(entry.source.end)}
                    </p>
                    <div className="review-grades">
                      {(['again', 'hard', 'good', 'easy'] as const).map((g, i) => {
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
                    <p className="small muted">
                      Again: missed it · Hard: recalled with effort · Good: recalled · Easy:
                      effortless.
                    </p>
                  </div>
                )}
              </article>
            ) : id ? (
              <section className="dictionary-empty" role="status">
                <h2>
                  {materialLoading || review.loading
                    ? 'Loading this word…'
                    : 'This word’s material is unavailable here yet.'}
                </h2>
                <p>
                  Cached words work offline. Your scheduled cards remain saved while material is
                  loading or unavailable.
                </p>
                {!materialLoading ? (
                  <div className="review-actions">
                    <button
                      className="button"
                      onClick={() => {
                        setError('');
                        setRetry((n) => n + 1);
                      }}
                    >
                      Retry material
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
                      Skip for this session
                    </button>
                  </div>
                ) : null}
                <button className="text-button" onClick={pause}>
                  Pause study
                </button>
              </section>
            ) : (
              <section className="dictionary-empty" role="status">
                <h2>
                  {review.loading
                    ? 'Opening your schedule…'
                    : delayed.length || skippedCount || limitedCount
                      ? 'Caught up for now'
                      : 'Today’s due queue is complete'}
                </h2>
                <p>
                  {activeSession.answered} ratings saved
                  {review.pending ? ' on this device, waiting to sync' : ''}.
                </p>
                {delayed.length ? (
                  <p>
                    {delayed.length} learning{' '}
                    {delayed.length === 1 ? 'card remains' : 'cards remain'} later today.
                    {upcoming
                      ? ` Next in ${reviewIntervalLabel(Math.max(0, Date.parse(upcoming.dueAt) - clock))}.`
                      : ''}
                  </p>
                ) : null}
                {skippedCount ? (
                  <p>
                    {skippedCount} unavailable {skippedCount === 1 ? 'card is' : 'cards are'} still
                    due. Retry when material is available.
                  </p>
                ) : null}
                {limitedCount ? (
                  <p>
                    {limitedCount} cards remain due beyond your daily limits. Today’s backlog is
                    still saved.
                  </p>
                ) : null}
                <div className="review-actions">
                  {limitedCount ? (
                    <button className="button primary" onClick={extendToday}>
                      Study all due today
                    </button>
                  ) : null}
                  {delayed.length ? (
                    <button
                      className="button primary"
                      disabled={!!review.conflict}
                      onClick={() => setSession({ ...activeSession, ahead: true, currentId: null })}
                    >
                      Study remaining today now
                    </button>
                  ) : null}
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
                    Pause study
                  </button>
                  <Link className="text-button" href="/">
                    Back to practice
                  </Link>
                </div>
                <p className="small muted">
                  This screen updates automatically as learning cards become due.
                </p>
              </section>
            )}
            {activeSession?.lastRating && (!entry || !card || revealed) ? (
              <button className="button review-undo" disabled={!!review.conflict} onClick={undo}>
                Undo last rating
              </button>
            ) : null}
            {review.pending ? (
              <p role="status">{review.pending} changes saved on this device · waiting to sync</p>
            ) : null}
            {review.conflict ? (
              <section className="review-notice" role="alert">
                <p>{review.conflict}</p>
                <p>
                  Check the restored schedule before continuing. Ratings on the changed card were
                  not accepted.
                </p>
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
                  Retry sync and material
                </button>
              </div>
            ) : null}
          </>
        )}
      </main>
    </>
  );
}
