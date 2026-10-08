'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState, useRef } from 'react';
import { useAccount } from './account';
import { useWordKnowledge } from './use-word-knowledge';
import { markWords } from '@/lib/knowledge/client';
import { wordStates, type WordState } from '@/lib/knowledge/types';
import { recentLessons } from '@/lib/storage/lessons';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { dictionaryPage } from '@/lib/dictionary/client';
import { lessonTokens } from '@/lib/knowledge/lesson';
import { contentWord } from '@/lib/knowledge/analysis';
import { canonicalLemma } from '@/lib/lexicon/lookup';
import { hiragana } from '@/lib/japanese-readings';
import { lookupJapanese } from '@/lib/lexicon/client';
import type { LexiconResult } from '@/lib/lexicon/types';
import { LexiconDefinitions } from './lexicon-definitions';
import { WordStateControls } from './word-state-controls';
import { transcriptKey } from '@/lib/transcript';
import { storageAccount } from '@/lib/storage/browser';
import { StandaloneNavigation } from './chrome';

type Word = {
  lemma: string;
  reading: string | null;
  count: number;
  lessonId?: string;
  segmentId?: string;
  sentence?: string;
  transcriptKey?: string;
};
export function WordBrowser() {
  const account = useAccount();
  return <WordBrowserContent key={account.user?.id ?? 'anonymous'} />;
}
function WordBrowserContent() {
  const { states, pending } = useWordKnowledge();
  const account = useAccount();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [corpus, setCorpus] = useState<Word[]>([]);
  const [loading, setLoading] = useState(false),
    [error, setError] = useState('');
  const [query, setQuery] = useState(''),
    [lookupQuery, setLookupQuery] = useState(''),
    [filter, setFilter] = useState<'all' | WordState>('all');
  const [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0);
  const [lookup, setLookup] = useState<LexiconResult | null>(null),
    [lookupLoading, setLookupLoading] = useState(false);
  const [savedWords, setSavedWords] = useState<Word[]>([]);
  const [analysisStage, setAnalysisStage] = useState(''),
    [analysed, setAnalysed] = useState(false),
    [notice, setNotice] = useState('');
  const lookupRequest = useRef(0);
  useEffect(() => {
    let active = true;
    const load = async () => {
      if (account.user) await dictionaryPage().catch(() => {});
      if (active)
        setSavedWords(
          Object.values(cachedDictionary().records).map(({ entry }) => ({
            lemma: entry.term,
            reading: entry.reading,
            count: 0,
            lessonId: entry.source.lessonId,
            segmentId: entry.source.segmentId,
            sentence: entry.sourceSentence,
            transcriptKey: entry.source.transcriptKey,
          })),
        );
    };
    void load();
    window.addEventListener('hibiki:dictionary-change', load);
    return () => {
      active = false;
      window.removeEventListener('hibiki:dictionary-change', load);
    };
  }, [account.user]);
  const words = useMemo(() => {
    const map = new Map<string, Word>([...savedWords, ...corpus].map((word) => [word.lemma, word]));
    for (const record of Object.values(states))
      map.set(record.lemma, {
        ...map.get(record.lemma),
        lemma: record.lemma,
        reading: record.reading ?? map.get(record.lemma)?.reading ?? null,
        count: map.get(record.lemma)?.count ?? 0,
      });
    return [...map.values()]
      .filter(
        (word) =>
          (filter === 'all' || (states[word.lemma]?.state ?? 'unknown') === filter) &&
          (!query.trim() ||
            word.lemma.includes(query.trim()) ||
            word.reading?.includes(query.trim())),
      )
      .sort((a, b) => b.count - a.count || a.lemma.localeCompare(b.lemma, 'ja'));
  }, [savedWords, corpus, states, filter, query]);
  const offset = Math.min(page * 100, Math.max(0, Math.floor((words.length - 1) / 100) * 100));
  const visible = words.slice(offset, offset + 100);
  const chosen = selected.filter((lemma) => words.some((word) => word.lemma === lemma));
  async function analyzeRecent() {
    const owner = storageAccount();
    const current = () => mounted.current && storageAccount() === owner;
    setLoading(true);
    setError('');
    try {
      const rows = new Map<string, Word>();
      const lessons = recentLessons();
      if (!lessons.length) {
        setNotice(
          'No recent lessons on this device. Open a lesson to find words in its Japanese transcript.',
        );
      }
      for (const [index, record] of lessons.entries()) {
        setAnalysisStage(`Finding words in lesson ${index + 1} of ${lessons.length}…`);
        const tokens = await lessonTokens(record.lesson);
        const revision = await transcriptKey(record.lesson);
        if (!current()) return;
        for (const segment of record.lesson.segments) {
          if (tokens[segment.id]?.map((token) => token.surface_form).join('') !== segment.japanese)
            continue;
          for (const token of tokens[segment.id].filter(contentWord)) {
            const lemma = canonicalLemma(token),
              previous = rows.get(lemma);
            rows.set(lemma, {
              lemma,
              reading: token.reading ? hiragana(token.reading) : null,
              count: (previous?.count ?? 0) + 1,
              lessonId: previous?.lessonId ?? record.lesson.id,
              segmentId: previous?.segmentId ?? segment.id,
              sentence: previous?.sentence ?? segment.japanese,
              transcriptKey: previous?.transcriptKey ?? revision,
            });
          }
        }
      }
      if (current()) {
        setCorpus([...rows.values()]);
        setAnalysed(true);
      }
    } catch {
      if (current())
        setError('Recent lesson analysis is unavailable. Tracked word states are still available.');
    } finally {
      if (current()) setLoading(false);
    }
  }
  async function find(term: string) {
    const owner = storageAccount();
    const current = () => mounted.current && storageAccount() === owner;
    const request = ++lookupRequest.current;
    const activeRequest = () => current() && request === lookupRequest.current;
    setLookupLoading(true);
    setLookup(null);
    setError('');
    try {
      const result = await lookupJapanese(term);
      if (activeRequest()) setLookup(result);
    } catch (reason) {
      if (activeRequest())
        setError(reason instanceof Error ? reason.message : 'Dictionary lookup unavailable.');
    } finally {
      if (activeRequest()) setLookupLoading(false);
    }
  }
  return (
    <>
      <StandaloneNavigation vocabularyView="knowledge" />
      <main className="dictionary-screen word-browser-screen">
        <div className="dictionary-page-heading">
          <div>
            <h1>Word knowledge</h1>
            <p>Mark words you recognise to personalise vocabulary in every lesson.</p>
          </div>
          <Link className="button small-button" href="/dictionary">
            Saved words
          </Link>
        </div>
        <p className="small muted">
          Marking a word changes its highlights and vocabulary coverage across lessons. It does not
          create a saved card or a review schedule, and review ratings do not change these marks.
          Word knowledge is included in Free
          {account.user
            ? ' and sync to your account.'
            : ' and stay on this device until you choose to import them into an account.'}
        </p>
        <dl className="knowledge-definitions">
          <div>
            <dt>Unknown</dt>
            <dd>Unmarked, or a word you want to learn.</dd>
          </div>
          <div>
            <dt>Learning</dt>
            <dd>You are working on recognising it.</dd>
          </div>
          <div>
            <dt>Known</dt>
            <dd>You choose to count it as familiar.</dd>
          </div>
          <div>
            <dt>Ignored</dt>
            <dd>Excluded from vocabulary coverage; kept in your list.</dd>
          </div>
        </dl>
        <section className="word-browser-toolbar" aria-label="Browse vocabulary">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (lookupQuery.trim() && !lookupLoading) void find(lookupQuery.trim());
            }}
          >
            <label>
              Look up a Japanese word
              <input
                aria-label="Find Japanese words"
                value={lookupQuery}
                maxLength={120}
                onChange={(event) => {
                  setLookupQuery(event.target.value);
                }}
              />
            </label>
            <button className="button small-button" disabled={!lookupQuery.trim() || lookupLoading}>
              {lookupLoading ? 'Looking up…' : 'Look up a word'}
            </button>
          </form>
          <label>
            Filter your words
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
                setSelected([]);
              }}
              placeholder="Japanese or reading"
            />
          </label>
          <label>
            Filter word state
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value as typeof filter);
                setPage(0);
                setSelected([]);
              }}
            >
              <option value="all">All states</option>
              {wordStates.map((state) => (
                <option key={state} value={state}>
                  {state[0].toUpperCase() + state.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button small-button"
            disabled={loading}
            onClick={() => void analyzeRecent()}
          >
            {loading
              ? 'Finding lesson words…'
              : analysed
                ? 'Refresh words from recent lessons'
                : 'Find words in recent lessons'}
          </button>
          <p className="small muted">
            Finding lesson words works on this device and may download an 18 MB Japanese dictionary
            the first time. After downloading, it can work offline. Dictionary meanings also stay
            available when cached.
          </p>
        </section>
        {loading ? (
          <p role="status">{analysisStage || 'Preparing the Japanese dictionary…'}</p>
        ) : null}
        {lookupLoading ? (
          <p role="status">Looking up {lookupQuery.trim() || 'the selected word'}…</p>
        ) : null}
        {notice ? (
          <p className="collection-notice" role="status">
            {notice}
          </p>
        ) : null}
        {lookup ? (
          <section className="word-browser-lookup" aria-label="Japanese dictionary lookup">
            <div className="vocabulary-heading">
              <h2 lang="ja">{lookup.selected}</h2>
              <button className="text-button" onClick={() => setLookup(null)}>
                Close dictionary result
              </button>
            </div>
            <LexiconDefinitions result={lookup} />
            <WordStateControls lemma={lookup.lemma} reading={lookup.matches[0]?.reading ?? null} />
          </section>
        ) : null}
        <div className="word-browser-bulk" aria-label="Bulk word states">
          <span>
            {chosen.length} selected across pages · {words.length} matching words
          </span>
          {wordStates.map((state) => (
            <button
              className="button small-button"
              disabled={!chosen.length}
              key={state}
              onClick={() => {
                markWords(
                  words.filter((word) => chosen.includes(word.lemma)),
                  state,
                );
                setNotice(
                  `Marked ${chosen.length} selected words ${state}. Saved cards and review schedules stay the same.`,
                );
                setSelected([]);
              }}
            >
              Mark selected {state[0].toUpperCase() + state.slice(1)}
            </button>
          ))}
        </div>
        <p className="small muted">
          Select all chooses only this page (up to 100 words). Your selection stays when paging;
          changing the search or state filter clears it.
        </p>
        {chosen.length ? (
          <button className="text-button" onClick={() => setSelected([])}>
            Clear selection
          </button>
        ) : null}
        {visible.length ? (
          <>
            <label className="word-browser-select">
              <input
                type="checkbox"
                checked={visible.every((word) => chosen.includes(word.lemma))}
                onChange={(event) =>
                  setSelected(
                    event.target.checked
                      ? [...new Set([...chosen, ...visible.map((word) => word.lemma)])]
                      : chosen.filter((lemma) => !visible.some((word) => word.lemma === lemma)),
                  )
                }
              />
              Select all on this page
            </label>
            <div className="word-browser-table">
              <table>
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Word / reading</th>
                    <th>State</th>
                    <th>Recent occurrences</th>
                    <th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((word) => (
                    <tr key={word.lemma}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Select ${word.lemma}`}
                          checked={chosen.includes(word.lemma)}
                          onChange={(event) =>
                            setSelected(
                              event.target.checked
                                ? [...chosen, word.lemma]
                                : chosen.filter((lemma) => lemma !== word.lemma),
                            )
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="text-button"
                          lang="ja"
                          onClick={() => void find(word.lemma)}
                        >
                          {word.lemma}
                        </button>
                        {word.reading ? <small lang="ja">{word.reading}</small> : null}
                      </td>
                      <td>
                        <select
                          aria-label={`State of ${word.lemma}`}
                          value={states[word.lemma]?.state ?? 'unknown'}
                          onChange={(event) => markWords([word], event.target.value as WordState)}
                        >
                          {wordStates.map((state) => (
                            <option key={state} value={state}>
                              {state[0].toUpperCase() + state.slice(1)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>{word.count || '—'}</td>
                      <td>
                        {word.lessonId && word.segmentId ? (
                          <Link
                            className="text-button"
                            href={`/practice/${encodeURIComponent(word.lessonId)}?section=${encodeURIComponent(word.segmentId)}${word.transcriptKey ? `&transcript=${encodeURIComponent(word.transcriptKey)}` : ''}`}
                            title={word.sentence}
                          >
                            Open section
                          </Link>
                        ) : (
                          'Marked by you'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="word-browser-pagination">
              <button
                className="button small-button"
                disabled={offset === 0}
                onClick={() => setPage(Math.max(0, Math.floor(offset / 100) - 1))}
              >
                Previous words
              </button>
              <span>
                {offset + 1}–{Math.min(words.length, offset + 100)} of {words.length}
              </span>
              <button
                className="button small-button"
                disabled={offset + 100 >= words.length}
                onClick={() => setPage(Math.floor(offset / 100) + 1)}
              >
                Next words
              </button>
            </div>
          </>
        ) : loading ? null : (
          <section className="dictionary-empty">
            <h2>
              {query || filter !== 'all'
                ? 'No words match these filters.'
                : 'Start with words from a lesson.'}
            </h2>
            <p>
              {query || filter !== 'all'
                ? 'Try a shorter Japanese word or reading, or show all word states.'
                : 'Look up a word above, find words in recent lessons, or mark words as you practise.'}
            </p>
            {query || filter !== 'all' ? (
              <button
                className="button"
                onClick={() => {
                  setQuery('');
                  setFilter('all');
                  setPage(0);
                  setSelected([]);
                }}
              >
                Clear word filters
              </button>
            ) : (
              <Link className="button" href="/practice/demo">
                Open the demo lesson
              </Link>
            )}
          </section>
        )}
        {pending ? (
          <p role="status">{pending} word state changes saved locally · waiting to sync</p>
        ) : null}
        {error ? (
          <p className="dictionary-page-error" role="alert">
            {error}{' '}
            <button
              className="text-button"
              disabled={loading || lookupLoading}
              onClick={() => void (lookupQuery.trim() ? find(lookupQuery.trim()) : analyzeRecent())}
            >
              Retry
            </button>
          </p>
        ) : null}
      </main>
    </>
  );
}
