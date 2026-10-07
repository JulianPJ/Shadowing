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
    [filter, setFilter] = useState<'all' | WordState>('all');
  const [selected, setSelected] = useState<string[]>([]),
    [page, setPage] = useState(0);
  const [lookup, setLookup] = useState<LexiconResult | null>(null),
    [lookupLoading, setLookupLoading] = useState(false);
  const [savedWords, setSavedWords] = useState<Word[]>([]);
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
      for (const record of recentLessons()) {
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
      if (current()) setCorpus([...rows.values()]);
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
    setLookupLoading(true);
    setError('');
    try {
      const result = await lookupJapanese(term);
      if (current()) setLookup(result);
    } catch (reason) {
      if (current())
        setError(reason instanceof Error ? reason.message : 'Dictionary lookup unavailable.');
    } finally {
      if (current()) setLookupLoading(false);
    }
  }
  return (
    <main className="dictionary-screen word-browser-screen">
      <div className="dictionary-page-heading">
        <div>
          <Link className="eyebrow" href="/">
            HIBIKI
          </Link>
          <h1>Word Browser</h1>
          <p>Japanese words you know follow you into every lesson.</p>
        </div>
        <Link className="button small-button" href="/dictionary">
          Saved dictionary
        </Link>
      </div>
      <p className="small muted">
        Unknown means unmarked or explicitly reset. Learning, Known and Ignored are your choices;
        review grades never silently mark a word Known. Word states are included in Free
        {account.user
          ? ' and sync to your account.'
          : ' and stay on this device until you choose to import them into an account.'}
      </p>
      <section className="word-browser-toolbar" aria-label="Browse vocabulary">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (query.trim()) void find(query.trim());
          }}
        >
          <label>
            Find Japanese words
            <input
              aria-label="Find Japanese words"
              value={query}
              maxLength={120}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <button className="button small-button" disabled={!query.trim() || lookupLoading}>
            {lookupLoading ? 'Looking up…' : 'Look up in JMdict'}
          </button>
        </form>
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
          {loading ? 'Analysing…' : 'Browse words from recent lessons'}
        </button>
        <p className="small muted">
          Recent lessons are analysed locally after you ask. The optional Japanese morphology
          dictionary is an 18 MB download. Lexical definitions load only the required JMdict shards.
        </p>
      </section>
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
          {chosen.length} selected · {words.length} matching terms
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
              setSelected([]);
            }}
          >
            Mark selected {state[0].toUpperCase() + state.slice(1)}
          </button>
        ))}
      </div>
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
      ) : (
        <p>
          No matching words yet. Browse a recent lesson, look up a Japanese word, or mark vocabulary
          during practice.
        </p>
      )}
      {pending ? (
        <p role="status">{pending} word state changes saved locally · waiting to sync</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
    </main>
  );
}
