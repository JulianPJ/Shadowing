'use client';
import Link from 'next/link';
import { BookPlus, Check, LoaderCircle, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Lesson, Segment } from '@/lib/types';
import { dictionaryTranslation } from '@/lib/dictionary/client';
import { dictionarySource } from '@/lib/dictionary/source';
import { cachedDictionary } from '@/lib/dictionary/cache';
import { normalizeDictionaryTerm } from '@/lib/dictionary/validation';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { lookupJapanese } from '@/lib/lexicon/client';
import type { LexiconResult } from '@/lib/lexicon/types';
import { markWords } from '@/lib/knowledge/client';
import { normalizeLemma } from '@/lib/knowledge/validation';
import type { WordState } from '@/lib/knowledge/types';
import { acknowledgeReviewConflict } from '@/lib/review/client';
import { storageAccount } from '@/lib/storage/browser';
import { syncStatus } from '@/lib/sync/client';
import { authPath } from '@/lib/auth/return-path';
import { activeCard, learnWord, markWordKnown, saveWordForReview } from '@/lib/vocabulary';
import { useAccount } from './account';
import { useReview } from './use-review';
import { useWordKnowledge } from './use-word-knowledge';
import { LexiconDefinitions } from './lexicon-definitions';

type PanelProps = {
  term: string;
  lesson: Lesson;
  segment: Segment;
  sourceTranslation?: string;
  reading?: string;
  onClose: () => void;
};

export function DictionarySavePanel(props: PanelProps) {
  const account = useAccount();
  return (
    <DictionarySaveContent
      key={`${account.user?.id ?? 'anonymous'}:${props.segment.id}:${props.term}`}
      {...props}
    />
  );
}

/** A word saved earlier from this exact sentence, if this device has it cached. */
function savedFromSentence(lemma: string, lesson: Lesson, segment: Segment) {
  const normalized = normalizeDictionaryTerm(lemma);
  return (
    Object.values(cachedDictionary().records).find(
      ({ entry }) =>
        entry.normalizedTerm === normalized &&
        entry.source.lessonId === lesson.id &&
        entry.source.segmentId === segment.id,
    )?.entry ?? null
  );
}

const statusNote: Record<WordState, string> = {
  unknown: '',
  learning: 'Learning — in your review queue.',
  known: 'Known — counted as familiar in every lesson.',
  ignored: 'Ignored — left out of vocabulary coverage.',
};

function DictionarySaveContent({
  term,
  lesson,
  segment,
  sourceTranslation,
  reading: initialReading,
  onClose,
}: PanelProps) {
  const account = useAccount();
  const review = useReview();
  const { states } = useWordKnowledge();
  const [translation, setTranslation] = useState('');
  const [reading, setReading] = useState(initialReading ?? '');
  const [lemma, setLemma] = useState(term.trim());
  const [sentenceMeaning, setSentenceMeaning] = useState(sourceTranslation ?? '');
  const [result, setResult] = useState<LexiconResult | null>(null);
  const [selectedSense, setSelectedSense] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<DictionaryEntry | null>(() =>
    savedFromSentence(term.trim(), lesson, segment),
  );
  const [error, setError] = useState('');
  const [lexiconError, setLexiconError] = useState('');
  const busy = useRef(false);
  const meaningTouched = useRef(false);
  const senseTouched = useRef(false);
  const readingTouched = useRef(!!initialReading);
  const sentenceTouched = useRef(false);
  const closeButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const verified = !!account.user?.emailVerified;
  const status = states[normalizeLemma(lemma)]?.state ?? 'unknown';
  const inReview = !!saved && !!activeCard(saved.id, review.data.cards);

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const content = panel.current;
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (
        previous?.isConnected &&
        (content?.contains(document.activeElement) || document.activeElement === document.body)
      )
        previous.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void lookupJapanese(term, segment.japanese)
      .then(async (lexical) => {
        if (!active) return;
        setResult(lexical);
        const match = lexical.matches[0];
        if (!senseTouched.current) {
          const dictionaryForm = match?.lemma ?? lexical.lemma;
          setLemma(dictionaryForm);
          setSaved((current) => current ?? savedFromSentence(dictionaryForm, lesson, segment));
        }
        if (match && !meaningTouched.current) {
          setTranslation(match.senses[0].gloss.join('; ').slice(0, 1000));
          setSelectedSense(`${match.entry.id}:${match.lemma}:${match.reading}:0`);
        }
        if (match && !readingTouched.current) setReading(match.reading);
        if (!match && !meaningTouched.current && verified) {
          const fallback = await dictionaryTranslation(
            term,
            { nextJapanese: segment.japanese },
            controller.signal,
          );
          if (active && !meaningTouched.current) setTranslation(fallback);
        }
      })
      .catch((reason) => {
        if (active)
          setLexiconError(
            reason instanceof Error ? reason.message : 'Japanese dictionary lookup is unavailable.',
          );
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [term, lesson, segment, verified, lookupAttempt]);

  useEffect(() => {
    if (!verified || sourceTranslation) return;
    const controller = new AbortController();
    const index = lesson.segments.findIndex((value) => value.id === segment.id);
    void dictionaryTranslation(
      segment.japanese,
      {
        previousJapanese: lesson.segments[index - 1]?.japanese,
        nextJapanese: lesson.segments[index + 1]?.japanese,
      },
      controller.signal,
    )
      .then((sentence) => {
        if (!controller.signal.aborted && !sentenceTouched.current) setSentenceMeaning(sentence);
      })
      .catch(() => {
        /* The Japanese sentence is saved either way; its translation is optional. */
      });
    return () => controller.abort();
  }, [verified, lesson, segment, sourceTranslation]);

  async function addToReview() {
    if (busy.current || !verified || !translation.trim()) return;
    busy.current = true;
    setSaving(true);
    setError('');
    const owner = account.user!.id;
    const current = () => storageAccount() === owner && syncStatus().user?.id === owner;
    try {
      if (review.conflict) acknowledgeReviewConflict();
      if (saved) learnWord(saved);
      else {
        const source = await dictionarySource(lesson, segment);
        if (!current()) return;
        const entry = await saveWordForReview({
          schemaVersion: 1,
          term: lemma,
          reading: reading.trim() || null,
          translation: translation.trim(),
          sourceSentence: segment.japanese,
          sourceSentenceTranslation: sentenceMeaning.trim(),
          source,
        });
        if (current()) setSaved(entry);
      }
    } catch (reason) {
      if (current())
        setError(reason instanceof Error ? reason.message : 'Could not save this word. Try again.');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }

  function setStatus(state: WordState) {
    setError('');
    try {
      if (state === 'known' && saved) markWordKnown(saved);
      else markWords([{ lemma, reading: reading || null }], state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not update this word.');
    }
  }

  function edited() {
    // A changed meaning or reading is saved with the next "Add to review".
    if (saved && !inReview) setSaved(null);
  }

  return (
    <aside
      ref={panel}
      className="dictionary-save-panel"
      aria-label="Save vocabulary"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="dictionary-save-heading">
        <div>
          <strong lang="ja">{term}</strong>
          {lemma !== term.trim() ? (
            <span className="small">
              Dictionary form · <span lang="ja">{lemma}</span>
            </span>
          ) : null}
        </div>
        <button
          ref={closeButton}
          className="icon-button"
          aria-label="Close vocabulary lookup"
          onClick={onClose}
        >
          <X size={16} />
        </button>
      </div>
      {!loaded ? (
        <p className="dictionary-loading" role="status">
          <LoaderCircle className="spin" size={15} />
          Finding the meaning…
        </p>
      ) : null}
      {result ? (
        <LexiconDefinitions
          result={result}
          selectedSense={selectedSense}
          onSense={(meaning, kana, dictionaryForm, senseId) => {
            if (saving) return;
            meaningTouched.current = true;
            senseTouched.current = true;
            readingTouched.current = true;
            setTranslation(meaning);
            setReading(kana);
            setLemma(dictionaryForm);
            setSelectedSense(senseId);
            edited();
          }}
        />
      ) : null}
      {lexiconError ? (
        <div className="dictionary-lookup-error" role="status">
          <p>{lexiconError}</p>
          <button
            className="text-button"
            disabled={!loaded || saving}
            onClick={() => {
              setLoaded(false);
              setLexiconError('');
              setLookupAttempt((value) => value + 1);
            }}
          >
            Retry dictionary lookup
          </button>
        </div>
      ) : null}
      <div className="dictionary-context">
        <p lang="ja">{segment.japanese}</p>
        {sentenceMeaning ? <p>{sentenceMeaning}</p> : null}
      </div>
      <div className="word-actions" role="group" aria-label={`Status for ${lemma}`}>
        {verified ? (
          inReview ? (
            <span className="word-status in-review">
              <Check size={15} /> In review
            </span>
          ) : (
            <button
              className="button primary"
              disabled={saving || !translation.trim()}
              onClick={() => void addToReview()}
            >
              <BookPlus size={15} />
              {saving ? 'Saving…' : saved ? 'Learn again' : 'Add to review'}
            </button>
          )
        ) : null}
        <button
          className="button small-button"
          aria-pressed={status === 'known'}
          onClick={() => setStatus(status === 'known' && !saved ? 'unknown' : 'known')}
        >
          Known
        </button>
        <button
          className="button small-button"
          aria-pressed={status === 'ignored'}
          onClick={() => setStatus(status === 'ignored' ? 'unknown' : 'ignored')}
        >
          Ignore
        </button>
      </div>
      {statusNote[status] ? <p className="small muted">{statusNote[status]}</p> : null}
      {!account.user ? (
        <p className="dictionary-signin small">
          <Link
            href={authPath(
              '/sign-in',
              `/practice/${encodeURIComponent(lesson.id)}?section=${encodeURIComponent(segment.id)}&lookup=${encodeURIComponent(term)}`,
            )}
          >
            Sign in to save words
          </Link>{' '}
          with their sentence and review them later.
        </p>
      ) : !verified ? (
        <p className="small" role="status">
          Verify your email to save words for review.
        </p>
      ) : !inReview ? (
        <details className="dictionary-edit">
          <summary>Edit before saving</summary>
          <div className="dictionary-fields">
            <label>
              Meaning
              <input
                aria-label="Vocabulary meaning"
                value={translation}
                maxLength={1000}
                disabled={saving}
                onChange={(event) => {
                  meaningTouched.current = true;
                  setSelectedSense('');
                  setTranslation(event.target.value);
                  edited();
                }}
              />
            </label>
            <label>
              Reading
              <input
                value={reading}
                maxLength={240}
                disabled={saving}
                onChange={(event) => {
                  readingTouched.current = true;
                  setReading(event.target.value);
                  edited();
                }}
              />
            </label>
            <label>
              Sentence meaning
              <textarea
                aria-label="Source sentence meaning"
                rows={2}
                maxLength={10000}
                value={sentenceMeaning}
                disabled={saving}
                onChange={(event) => {
                  sentenceTouched.current = true;
                  setSentenceMeaning(event.target.value);
                  edited();
                }}
              />
            </label>
          </div>
        </details>
      ) : null}
      {error ? (
        <p className="dictionary-error" role="alert">
          {error}
        </p>
      ) : null}
      {saved ? (
        <Link className="text-button" href="/words">
          View your words
        </Link>
      ) : null}
    </aside>
  );
}
