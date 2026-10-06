'use client';
import Link from 'next/link';
import { BookPlus, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Lesson, Segment } from '@/lib/types';
import { dictionaryTranslation, saveDictionary } from '@/lib/dictionary/client';
import { dictionarySource } from '@/lib/dictionary/source';
import { lookupJapanese } from '@/lib/lexicon/client';
import type { LexiconResult } from '@/lib/lexicon/types';
import { useAccount } from './account';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { changeReview } from '@/lib/review/client';
import { LexiconDefinitions } from './lexicon-definitions';
import { WordStateControls } from './word-state-controls';
import { storageAccount } from '@/lib/storage/browser';
import { syncStatus } from '@/lib/sync/client';

export function DictionarySavePanel({
  term,
  lesson,
  segment,
  sourceTranslation,
  reading: initialReading,
  onClose,
}: {
  term: string;
  lesson: Lesson;
  segment: Segment;
  sourceTranslation?: string;
  reading?: string;
  onClose: () => void;
}) {
  const account = useAccount();
  return (
    <DictionarySaveContent
      key={account.user?.id ?? 'anonymous'}
      term={term}
      lesson={lesson}
      segment={segment}
      sourceTranslation={sourceTranslation}
      reading={initialReading}
      onClose={onClose}
    />
  );
}

function DictionarySaveContent({
  term,
  lesson,
  segment,
  sourceTranslation,
  reading: initialReading,
  onClose,
}: {
  term: string;
  lesson: Lesson;
  segment: Segment;
  sourceTranslation?: string;
  reading?: string;
  onClose: () => void;
}) {
  const account = useAccount();
  const [translation, setTranslation] = useState('');
  const [reading, setReading] = useState(initialReading ?? '');
  const [sentenceMeaning, setSentenceMeaning] = useState(sourceTranslation ?? '');
  const [result, setResult] = useState<LexiconResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedEntry, setSavedEntry] = useState<DictionaryEntry | null>(null);
  const [inReview, setInReview] = useState(false);
  const [error, setError] = useState('');
  const [lexiconError, setLexiconError] = useState('');
  const saved = !!savedEntry;
  const lemma = result?.lemma ?? term.trim();

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void lookupJapanese(term, segment.japanese)
      .then(async (lexical) => {
        if (!active) return;
        setResult(lexical);
        const match = lexical.matches[0];
        if (match) {
          setTranslation(match.senses[0].gloss.join('; ').slice(0, 1000));
          setReading(match.reading);
        } else if (account.user?.emailVerified) {
          const fallback = await dictionaryTranslation(
            term,
            { nextJapanese: segment.japanese },
            controller.signal,
          );
          if (active) setTranslation(fallback);
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
  }, [term, segment.japanese, account.user?.id, account.user?.emailVerified]);

  useEffect(() => {
    if (!account.user?.emailVerified || sourceTranslation) return;
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
        if (!controller.signal.aborted) setSentenceMeaning(sentence);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error
              ? reason.message
              : 'Enter a sentence meaning to save this context.',
          );
      });
    return () => controller.abort();
  }, [account.user?.id, account.user?.emailVerified, lesson, segment, sourceTranslation]);

  async function save() {
    if (!account.user?.emailVerified || !translation.trim() || !sentenceMeaning.trim()) return;
    setSaving(true);
    setError('');
    const owner = account.user.id;
    try {
      const source = await dictionarySource(lesson, segment);
      if (storageAccount() !== owner || syncStatus().user?.id !== owner) return;
      const entry = await saveDictionary({
        schemaVersion: 1,
        term: lemma,
        reading: reading.trim() || null,
        translation: translation.trim(),
        sourceSentence: segment.japanese,
        sourceSentenceTranslation: sentenceMeaning.trim(),
        source,
      });
      if (storageAccount() === owner && syncStatus().user?.id === owner) setSavedEntry(entry);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save this vocabulary.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside className="dictionary-save-panel" aria-label="Save vocabulary">
      <div className="dictionary-save-heading">
        <div>
          <span className="eyebrow">JAPANESE DICTIONARY</span>
          <strong lang="ja">{term}</strong>
        </div>
        <button className="icon-button" aria-label="Close vocabulary lookup" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {!loaded ? (
        <p className="dictionary-loading" role="status">
          <LoaderCircle className="spin" size={15} />
          Finding the dictionary meaning…
        </p>
      ) : result ? (
        <LexiconDefinitions
          result={result}
          onSense={(meaning, kana) => {
            setTranslation(meaning);
            setReading(kana);
            setSavedEntry(null);
          }}
        />
      ) : null}
      {lexiconError ? (
        <p className="small muted" role="status">
          {lexiconError}
        </p>
      ) : null}
      <WordStateControls lemma={lemma} reading={reading || null} />
      <div className="dictionary-context">
        <span>Meaning in this sentence</span>
        <p lang="ja">{segment.japanese}</p>
        {sentenceMeaning ? (
          <p>{sentenceMeaning}</p>
        ) : (
          <p className="small muted">
            The source sentence is the example. Sentence translation can help choose the right
            sense; lexical senses do not claim which one this speaker intended.
          </p>
        )}
      </div>
      {!account.user ? (
        <div className="dictionary-signin">
          <p>
            Dictionary lookup and word states are Free and work on this device. Sign in to save
            source-linked vocabulary to your personal dictionary and review it.
          </p>
          <Link className="button primary" href="/sign-in">
            Sign in to save
          </Link>
        </div>
      ) : !account.user.emailVerified ? (
        <p role="status">
          Verify your account email before saving vocabulary. Word states stay available locally.
        </p>
      ) : (
        <>
          <div className="dictionary-fields">
            <label>
              Reading (optional)
              <input
                value={reading}
                onChange={(event) => {
                  setReading(event.target.value);
                  setSavedEntry(null);
                }}
              />
            </label>
            <label>
              Meaning
              <input
                aria-label="Vocabulary meaning"
                value={translation}
                maxLength={1000}
                onChange={(event) => {
                  setTranslation(event.target.value);
                  setSavedEntry(null);
                }}
              />
            </label>
            <label>
              Sentence meaning
              <textarea
                aria-label="Source sentence meaning"
                rows={2}
                value={sentenceMeaning}
                onChange={(event) => {
                  setSentenceMeaning(event.target.value);
                  setSavedEntry(null);
                }}
              />
            </label>
          </div>
          {error ? (
            <p className="small dictionary-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="dictionary-save-actions">
            <button
              className="button primary"
              disabled={!loaded || saving || !translation.trim() || !sentenceMeaning.trim()}
              onClick={() => void save()}
            >
              <BookPlus size={15} />
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save to dictionary'}
            </button>
            {saved ? (
              <button
                className="button small-button"
                disabled={inReview}
                onClick={() => {
                  if (
                    savedEntry &&
                    storageAccount() === account.user?.id &&
                    syncStatus().user?.id === account.user?.id
                  ) {
                    changeReview({
                      action: 'enroll',
                      entryIds: [savedEntry.id],
                      deckId: 'inbox',
                      enrolledAt: new Date().toISOString(),
                    });
                    setInReview(true);
                  }
                }}
              >
                {inReview ? 'Added to review' : 'Add to review'}
              </button>
            ) : null}
            {saved ? (
              <Link className="text-button" href="/dictionary">
                View dictionary
              </Link>
            ) : null}
          </div>
          <p className="dictionary-privacy">
            {saved ? <span role="status">Saved to My Words · Inbox. </span> : null}Saving keeps the
            dictionary form, chosen gloss and exact source context in your account. Your word
            knowledge state changes only when you mark it.
          </p>
        </>
      )}
    </aside>
  );
}
