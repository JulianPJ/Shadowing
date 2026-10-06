'use client';
import Link from 'next/link';
import { BookPlus, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Lesson, Segment } from '@/lib/types';
import { dictionaryTranslation, saveDictionary } from '@/lib/dictionary/client';
import { dictionarySource } from '@/lib/dictionary/source';
import { useAccount } from './account';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { changeReview } from '@/lib/review/client';

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
  const [translation, setTranslation] = useState('');
  const [reading, setReading] = useState(initialReading ?? '');
  const [sentenceMeaning, setSentenceMeaning] = useState(sourceTranslation ?? '');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedEntry, setSavedEntry] = useState<DictionaryEntry | null>(null);
  const [inReview, setInReview] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!account.user?.emailVerified || !term.trim()) return;
    const controller = new AbortController();
    const segmentIndex = lesson.segments.findIndex((value) => value.id === segment.id);
    void Promise.all([
      dictionaryTranslation(
        term,
        term.trim() === segment.japanese.trim() ? undefined : { nextJapanese: segment.japanese },
        controller.signal,
      ),
      sourceTranslation
        ? Promise.resolve(sourceTranslation)
        : dictionaryTranslation(
            segment.japanese,
            {
              previousJapanese:
                segmentIndex > 0 ? lesson.segments[segmentIndex - 1]?.japanese : undefined,
              nextJapanese:
                segmentIndex >= 0 ? lesson.segments[segmentIndex + 1]?.japanese : undefined,
            },
            controller.signal,
          ),
    ])
      .then(([termMeaning, sentence]) => {
        if (controller.signal.aborted) return;
        setTranslation(termMeaning);
        setSentenceMeaning(sentence);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error ? reason.message : 'Translation is unavailable right now.',
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [account.user?.emailVerified, account.user?.plan, lesson, segment, sourceTranslation, term]);

  async function save() {
    if (!account.user?.emailVerified || !translation.trim() || !sentenceMeaning.trim()) return;
    setSaving(true);
    setError('');
    try {
      const entry = await saveDictionary({
        schemaVersion: 1,
        term: term.trim(),
        reading: reading.trim() || null,
        translation: translation.trim(),
        sourceSentence: segment.japanese,
        sourceSentenceTranslation: sentenceMeaning.trim(),
        source: await dictionarySource(lesson, segment),
      });
      setSavedEntry(entry);
      setSaved(true);
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
          <span className="eyebrow">PERSONAL DICTIONARY</span>
          <strong lang="ja">{term}</strong>
        </div>
        <button className="icon-button" aria-label="Close vocabulary lookup" onClick={onClose}>
          <X size={16} />
        </button>
      </div>
      {!account.user ? (
        <div className="dictionary-signin">
          <p>Sign in to translate and save this word or phrase to your personal dictionary.</p>
          <Link className="button primary" href="/sign-in">
            Sign in to save
          </Link>
        </div>
      ) : !account.user.emailVerified ? (
        <p role="status">Verify your account email before saving vocabulary.</p>
      ) : (
        <>
          {!loaded ? (
            <p className="dictionary-loading" role="status">
              <LoaderCircle className="spin" size={15} />
              Finding the meaning…
            </p>
          ) : (
            <div className="dictionary-fields">
              <label>
                Reading (optional)
                <input
                  value={reading}
                  onChange={(e) => {
                    setReading(e.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <label>
                Meaning
                <input
                  aria-label="Vocabulary meaning"
                  value={translation}
                  onChange={(event) => {
                    setTranslation(event.target.value);
                    setSaved(false);
                  }}
                />
              </label>
              <div className="dictionary-context">
                <span>From this sentence</span>
                <p lang="ja">{segment.japanese}</p>
                <label>
                  Sentence meaning
                  <textarea
                    aria-label="Source sentence meaning"
                    rows={2}
                    value={sentenceMeaning}
                    onChange={(event) => {
                      setSentenceMeaning(event.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
              </div>
            </div>
          )}
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
                  if (savedEntry) {
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
            {saved ? <span role="status">Saved to My Words · Inbox. </span> : null}
            Saving stores this selection, sentence, meanings, source identity and section timestamps
            in your account so it can be reviewed in context. Recordings are never included.
          </p>
        </>
      )}
    </aside>
  );
}
