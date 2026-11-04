'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { VocabularyHeader } from './vocabulary-header';
import { ProFeatureNotice, useProAccess } from './pro-feature';
import { useAccount } from './account';
import { useReview } from './use-review';
import { useWordKnowledge } from './use-word-knowledge';
import { dictionaryByIds, dictionaryPage, dictionaryRequest } from '@/lib/dictionary/client';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { reviewHistory } from '@/lib/review/history';
import { pendingReview } from '@/lib/review/client';
import { relatedWords, vocabularyDashboard, wordKanji } from '@/lib/vocabulary-dashboard';
import { reviewContextHref } from '@/lib/dictionary/replay';
import { activeCard, learnWord, markWordKnown } from '@/lib/vocabulary';
import dynamic from 'next/dynamic';
const ReviewContextPlayer = dynamic(
  () => import('./review-context-player').then((m) => m.ReviewContextPlayer),
  { loading: () => <p role="status">Opening sentence audio…</p> },
);
import { normalizeLemma } from '@/lib/knowledge/validation';

type Collection = { id: string; name: string };
export function VocabularyDashboard() {
  const { isPro } = useProAccess('vocabulary');
  const account = useAccount();
  return !isPro ? (
    <main className="dictionary-screen">
      <VocabularyHeader active="overview" />
      <ProFeatureNotice feature="Personal learning dashboard" />
    </main>
  ) : account.user ? (
    <Dashboard key={account.user.id} />
  ) : (
    <main className="dictionary-screen">
      <VocabularyHeader active="overview" />
      <p>Sign in to open your personal learning dashboard.</p>
    </main>
  );
}
function Dashboard() {
  const review = useReview();
  const { states } = useWordKnowledge();
  const [loadedEntries, setEntries] = useState<DictionaryEntry[]>([]);
  const [readyCollection, setReadyCollection] = useState<string | null>(null);
  const materialGeneration = useRef(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionCursor, setCollectionCursor] = useState<string | null>(null);
  const [collection, setCollection] = useState('');
  const entries = readyCollection === collection ? loadedEntries : [];
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [word, setWord] = useState<DictionaryEntry>();
  const [kanji, setKanji] = useState('');
  const [lesson, setLesson] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [session, setSession] = useState<DictionaryEntry[] | null>(null);
  const [practiceRun, setPracticeRun] = useState(0);
  const [detailEntries, setDetailEntries] = useState<DictionaryEntry[]>([]);
  const [historyEntries, setHistoryEntries] = useState<DictionaryEntry[]>([]);
  const [clock, setClock] = useState(() => new Date().toISOString());
  const history = useMemo(() => {
    const undone = new Set(
      pendingReview().flatMap((o) => (o.action === 'undo' ? [o.targetOperationId] : [])),
    );
    return reviewHistory().filter((e) => !undone.has(e.operationId));
    // The review hook is the subscription for both local reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.data, review.pending]);
  const data = useMemo(
    () => vocabularyDashboard(review.data.cards, history, clock),
    [review.data.cards, history, clock],
  );
  useEffect(() => {
    const timer = setInterval(() => setClock(new Date().toISOString()), 60000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (word) {
      const title = document.getElementById('word-detail-title');
      title?.focus();
      title?.scrollIntoView({ block: 'center' });
    }
  }, [word]);
  useEffect(() => {
    if (session) {
      const title = document.getElementById('targeted-title');
      title?.focus();
      title?.scrollIntoView({ block: 'center' });
    }
  }, [session, practiceRun]);
  useEffect(() => {
    let active = true;
    void dictionaryRequest('/api/vocabulary/collections')
      .then((r) => {
        if (active) {
          const page = r as { collections: Collection[]; nextCursor?: string | null };
          setCollections(page.collections);
          setCollectionCursor(page.nextCursor ?? null);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    const id = new URL(window.location.href).searchParams.get('word');
    if (id && /^[\w-]{1,100}$/.test(id))
      void dictionaryByIds([id])
        .then((words) => {
          if (active) {
            setDetailEntries(words);
            setWord(words[0]);
          }
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    materialGeneration.current++;
    void dictionaryPage(collection ? { collectionId: collection } : {})
      .then((p) => {
        if (active) {
          setEntries(p.entries);
          setReadyCollection(collection);
          setCursor(p.nextCursor);
          setOffline(!!p.offline);
          setSelected([]);
        }
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [collection]);
  // At most 120 actionable contexts, separately from the bounded browser cache.
  const evidenceIds = JSON.stringify([
    ...new Set([
      ...data.reviewedWords.slice(0, 100),
      ...data.difficult.slice(0, 20).map((d) => d.entryId),
    ]),
  ]);
  useEffect(() => {
    let active = true;
    const ids = JSON.parse(evidenceIds) as string[];
    if (!ids.length) return;
    void Promise.all(
      [ids.slice(0, 50), ids.slice(50, 100), ids.slice(100)]
        .filter((g) => g.length)
        .map((g) => dictionaryByIds(g)),
    )
      .then((groups) => {
        if (active) setHistoryEntries(groups.flat());
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [evidenceIds]);
  const all = [
    ...new Map([...entries, ...historyEntries, ...detailEntries].map((e) => [e.id, e])).values(),
  ];
  const lookup = new Map(all.map((e) => [e.id, e]));
  const status = (e: DictionaryEntry) =>
    states[normalizeLemma(e.term)]?.state ??
    (activeCard(e.id, review.data.cards) ? 'learning' : 'unknown');
  const terms = new Map(entries.map((e) => [normalizeLemma(e.term), status(e)]));
  const known = [...terms.values()].filter((s) => s === 'known').length;
  const learning = [...terms.values()].filter((s) => s === 'learning').length;
  const filtered = entries.filter(
    (e) => (!kanji || e.term.includes(kanji)) && (!lesson || e.source.lessonId === lesson),
  );
  const detailCard = review.data.cards.find((c) => c.entryId === word?.id);
  const detailRatings = history.filter((e) => e.entryId === word?.id);
  async function more() {
    if (!cursor) return;
    const generation = materialGeneration.current;
    setBusy(true);
    try {
      const p = await dictionaryPage(
        { cursor, ...(collection ? { collectionId: collection } : {}) },
        true,
      );
      if (generation !== materialGeneration.current) return;
      setEntries((es) => [...new Map([...es, ...p.entries].map((e) => [e.id, e])).values()]);
      setCursor(p.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function moreCollections() {
    setBusy(true);
    try {
      const page = (await dictionaryRequest(
        '/api/vocabulary/collections?' + new URLSearchParams({ cursor: collectionCursor! }),
      )) as { collections: Collection[]; nextCursor: string | null };
      setCollections((c) => [...c, ...page.collections]);
      setCollectionCursor(page.nextCursor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function select(ids: string[]) {
    setSelected([...new Set(ids)].filter((id) => lookup.has(id)).slice(0, 20));
  }
  function act(action: () => void) {
    try {
      action();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const row = (e: DictionaryEntry, reasons?: string[]) => (
    <li key={e.id} className="dashboard-word">
      <label>
        <input
          type="checkbox"
          aria-label={`Select ${e.term}`}
          checked={selected.includes(e.id)}
          disabled={!selected.includes(e.id) && selected.length >= 20}
          onChange={(ev) =>
            setSelected((s) => (ev.target.checked ? [...s, e.id] : s.filter((id) => id !== e.id)))
          }
        />
        <span className="sr-only">Select word</span>
      </label>
      <button className="text-button dashboard-word-name" lang="ja" onClick={() => setWord(e)}>
        {e.term}
        <small>{e.reading}</small>
      </button>
      <span>{e.translation}</span>
      <span className="small muted">{status(e)}</span>
      {reasons ? <p className="dashboard-word-reasons">{reasons.join(' · ')}</p> : null}
    </li>
  );
  return (
    <main className="dictionary-screen vocabulary-workspace">
      <VocabularyHeader active="overview" />
      <div className="dashboard-lead">
        <div>
          <h2>Your next words</h2>
          <p>Return to a sentence, revisit a difficult word, or pick a short practice session.</p>
        </div>
        <Link className="button primary" href="/review">
          Review · {data.dueToday} due today
        </Link>
      </div>
      {readyCollection !== collection ? <p role="status">Opening vocabulary…</p> : null}
      <dl className="vocabulary-totals">
        <div>
          <dt>Learning</dt>
          <dd>{learning}</dd>
        </div>
        <div>
          <dt>Known</dt>
          <dd>{known}</dd>
        </div>
        <div>
          <dt>Words reviewed today</dt>
          <dd>{data.reviewedWords.length}</dd>
        </div>
        <div>
          <dt>Answers today</dt>
          <dd>{data.todayEvents.length}</dd>
        </div>
      </dl>
      <p className="small muted">
        Learning and Known count unique words in the {entries.length} loaded contexts
        {cursor ? ' · more available' : ''}
        {offline ? ' · device cache only' : ''}. Review counts use the current synced schedule and
        available ratings.
      </p>
      <nav className="dashboard-jump" aria-label="Learning dashboard">
        <a href="#today-review">Today’s review</a>
        <a href="#revisit-words">Words to revisit</a>
        <a href="#explore-words">Words & kanji</a>
        <a href="#schedule-snapshot">Upcoming reviews</a>
        <Link href="/profile">Daily goal & weekly report</Link>
        {selected.length ? (
          <a href="#targeted-selection">Practise {selected.length} selected words</a>
        ) : null}
      </nav>
      <section className="dashboard-section" aria-labelledby="activity-title">
        <h2 id="activity-title">Recent activity</h2>
        <p className="small muted">
          Available ratings:{' '}
          {data.historyStart ? new Date(data.historyStart).toLocaleDateString() : 'none yet'}{' '}
          through today. Server sync supplies seven days; this device may retain older events, up to
          10,000. Missing days do not prove no practice occurred.
        </p>
        <ol className="dashboard-activity">
          {data.activity.map((day) => (
            <li key={day.day}>
              <span>{day.day.slice(5)}</span>
              <strong>{day.answers}</strong>
              <span className="small">answers</span>
            </li>
          ))}
        </ol>
      </section>
      <section id="today-review" className="dashboard-section">
        <h2>Today’s review</h2>
        <p>
          {Object.entries(data.grades)
            .map(([g, n]) => `${g[0].toUpperCase() + g.slice(1)} ${n}`)
            .join(' · ')}
        </p>
        {data.reviewedWords.length ? (
          <>
            <button className="text-button" onClick={() => select(data.reviewedWords)}>
              Select up to 20 reviewed words
            </button>
            <ul className="dashboard-words">
              {data.reviewedWords.slice(0, 100).map((id) => {
                const e = lookup.get(id);
                return e ? (
                  row(e, [
                    `${data.todayEvents.filter((h) => h.entryId === id).length} answers today`,
                    ...(data.todayEvents.some(
                      (h) => h.entryId === id && ['again', 'hard'].includes(h.grade),
                    )
                      ? ['Needs another look']
                      : []),
                  ])
                ) : (
                  <li key={id}>Word context unavailable; its rating remains counted.</li>
                );
              })}
            </ul>
            {data.reviewedWords.length > 100 ? (
              <p>Showing the first 100 reviewed contexts.</p>
            ) : null}
          </>
        ) : (
          <p>
            No ratings in today’s available history. <Link href="/review">Start review</Link>
          </p>
        )}
      </section>
      <section id="revisit-words" className="dashboard-section">
        <h2>Words to revisit</h2>
        <p>
          Ranked by recorded lapses and Again/Hard answers in the available last seven days. A few
          ratings are limited evidence, not a reliable assessment.
        </p>
        <button
          className="text-button"
          disabled={!data.difficult.length}
          onClick={() => select(data.difficult.map((d) => d.entryId))}
        >
          Select up to 20 words to revisit
        </button>
        <ul className="dashboard-words">
          {data.difficult.slice(0, 20).map((d) => {
            const e = lookup.get(d.entryId);
            return e ? (
              row(e, [...d.reasons, ...(d.evidence < 5 ? ['Limited recent evidence'] : [])])
            ) : (
              <li key={d.entryId}>Context not loaded · {d.reasons.join(' · ')}</li>
            );
          })}
        </ul>
        {!data.difficult.length ? <p>No difficulty evidence in the available data yet.</p> : null}
      </section>
      <section id="explore-words" className="dashboard-section">
        <h2>Explore your words</h2>
        {collectionCursor ? (
          <button className="text-button" disabled={busy} onClick={() => void moreCollections()}>
            Load 100 more collections
          </button>
        ) : null}
        <div className="dashboard-filters">
          <label>
            Imported collection
            <select
              value={collection}
              onChange={(e) => {
                setCollection(e.target.value);
                setKanji('');
                setLesson('');
              }}
            >
              <option value="">All sources</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.replaceAll('::', ' / ')}
                </option>
              ))}
            </select>
          </label>
          <label>
            Lesson
            <select value={lesson} onChange={(e) => setLesson(e.target.value)}>
              <option value="">All lessons and imports</option>
              {[
                ...new Map(
                  entries
                    .filter((e) => e.source.kind !== 'anki')
                    .map((e) => [e.source.lessonId, e.source.lessonTitle]),
                ).entries(),
              ].map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Kanji in loaded words
            <select value={kanji} onChange={(e) => setKanji(e.target.value)}>
              <option value="">All characters</option>
              {[...new Set(entries.flatMap((e) => wordKanji(e.term)))].sort().map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p>
          Relationships are drawn from loaded vocabulary. Whole-word readings are shown; individual
          kanji readings are not inferred.
        </p>
        <button
          className="text-button"
          disabled={!filtered.length}
          onClick={() => select(filtered.map((e) => e.id))}
        >
          Select up to 20 matching words
        </button>
        <ul className="dashboard-words">{filtered.map((e) => row(e))}</ul>
        {!filtered.length ? (
          <p>
            No loaded words match. Save words from a lesson or{' '}
            <Link href="/vocabulary/import">import an Anki deck</Link>.
          </p>
        ) : null}
        {cursor ? (
          <button className="button" disabled={busy} onClick={() => void more()}>
            {busy ? 'Loading…' : 'Load 100 more contexts'}
          </button>
        ) : null}
      </section>
      {word ? (
        <section className="dashboard-section word-details" aria-labelledby="word-detail-title">
          <div className="collection-bulk-actions">
            <h2 id="word-detail-title" tabIndex={-1} lang="ja">
              {word.term}
            </h2>
            <button className="text-button" onClick={() => setWord(undefined)}>
              Close details
            </button>
          </div>
          <p lang="ja">{word.reading}</p>
          <p>{word.translation || 'No meaning mapped'}</p>
          <p>Status: {status(word)}</p>
          <p lang="ja">{word.sourceSentence}</p>
          <p>{word.sourceSentenceTranslation}</p>
          <p>
            {word.source.kind === 'anki'
              ? `Anki import · ${word.source.collection}`
              : word.source.lessonTitle}
          </p>
          {word.source.kind !== 'anki' ? (
            <>
              <ReviewContextPlayer key={word.id} entry={word} />
              <Link href={reviewContextHref(word)}>Open original lesson</Link>
            </>
          ) : null}
          <p>
            {data.difficult.find((d) => d.entryId === word.id)?.reasons.join(' · ') ||
              'No difficulty evidence in available history.'}
          </p>
          <p>
            {detailRatings.length} answers in available history ·{' '}
            {(['again', 'hard', 'good', 'easy'] as const)
              .map((g) => `${g}: ${detailRatings.filter((r) => r.grade === g).length}`)
              .join(' · ')}
          </p>
          {detailCard && detailCard.status !== 'suspended' ? (
            <p>
              Currently scheduled: {new Date(detailCard.dueAt).toLocaleString()} ·{' '}
              {detailCard.status} · current interval {detailCard.intervalDays} days
            </p>
          ) : null}
          <div className="collection-bulk-actions">
            <button className="button" onClick={() => act(() => markWordKnown(word))}>
              Mark known
            </button>
            <button className="button" onClick={() => act(() => learnWord(word))}>
              Learn again
            </button>
            {wordKanji(word.term).map((k) => (
              <button
                className="button"
                key={k}
                onClick={() => {
                  setKanji(k);
                  document.getElementById('explore-words')?.scrollIntoView();
                }}
              >
                Explore {k}
              </button>
            ))}
          </div>
          <h3>Words sharing this reading</h3>
          <ul>
            {relatedWords(word, all).map((e) => (
              <li key={e.id}>
                <button className="text-button" onClick={() => setWord(e)}>
                  {e.term} · {e.translation}
                </button>
              </li>
            ))}
          </ul>
          {!relatedWords(word, all).length ? <p>No matches in loaded words.</p> : null}
        </section>
      ) : null}
      <section id="schedule-snapshot" className="dashboard-section">
        <h2>Currently scheduled</h2>
        <p>
          {data.overdue} overdue. This snapshot uses current due dates. Future answers will change
          the schedule.
        </p>
        <ol className="dashboard-schedule">
          {data.schedule.map((d) => (
            <li key={d.day}>
              <span>{d.day.slice(5)}</span>
              <strong>{d.cards}</strong>
              <span className="small">cards</span>
            </li>
          ))}
        </ol>
      </section>
      <section
        id="targeted-selection"
        className="dashboard-selection"
        aria-label="Targeted practice"
      >
        <p>{selected.length} / 20 words selected</p>
        <button
          className="button primary"
          disabled={!selected.length}
          onClick={() => {
            const words = selected.flatMap((id) => (lookup.get(id) ? [lookup.get(id)!] : []));
            if (!words.length) {
              setSelected([]);
              return;
            }
            setPracticeRun((n) => n + 1);
            setSession(words);
          }}
        >
          Practise selected words
        </button>
        <button className="text-button" disabled={!selected.length} onClick={() => setSelected([])}>
          Clear selection
        </button>
      </section>
      {session ? (
        <TargetedPractice key={practiceRun} entries={session} close={() => setSession(null)} />
      ) : null}
      {error || review.error ? <p role="alert">{error || review.error}</p> : null}
    </main>
  );
}
function TargetedPractice({ entries, close }: { entries: DictionaryEntry[]; close: () => void }) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [notice, setNotice] = useState('');
  const e = entries[index];
  if (!e)
    return (
      <section className="dashboard-section">
        <p>No selected word is available. Choose your words again.</p>
        <button className="button" onClick={close}>
          End practice
        </button>
      </section>
    );
  return (
    <section className="dashboard-section targeted-practice" aria-labelledby="targeted-title">
      <h2 id="targeted-title" tabIndex={-1}>
        Short practice · {index + 1} / {entries.length}
      </h2>
      <p>
        Text and context practice. Answers here do not change your review schedule or rating
        history.
      </p>
      <h3 lang="ja">{e.term}</h3>
      {revealed ? (
        <>
          <p lang="ja">{e.reading}</p>
          <p>{e.translation}</p>
          <p lang="ja">{e.sourceSentence}</p>
          <p>{e.sourceSentenceTranslation}</p>
          {e.source.kind !== 'anki' ? <ReviewContextPlayer key={e.id} entry={e} /> : null}
        </>
      ) : (
        <button className="button" onClick={() => setRevealed(true)}>
          Reveal meaning & sentence
        </button>
      )}
      <div className="collection-bulk-actions">
        <button
          className="button"
          onClick={() => {
            if (index + 1 === entries.length) close();
            else {
              setIndex((n) => n + 1);
              setRevealed(false);
            }
          }}
        >
          {index + 1 === entries.length ? 'Finish practice' : 'Next word'}
        </button>
        <button
          className="text-button"
          onClick={() =>
            void navigator.clipboard
              .writeText(
                'Write a short Japanese passage using these words:\n' +
                  entries.map((w) => `${w.term} (${w.reading ?? ''}): ${w.translation}`).join('\n'),
              )
              .then(() => setNotice('Prompt copied.'))
              .catch(() => setNotice('Clipboard unavailable. Select and copy your words manually.'))
          }
        >
          Copy writing prompt
        </button>
        <button className="text-button" onClick={close}>
          End practice
        </button>
      </div>
      <p role="status">{notice}</p>
    </section>
  );
}
