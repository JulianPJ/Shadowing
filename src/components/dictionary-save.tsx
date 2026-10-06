'use client';
import Link from 'next/link';
import { BookPlus, LoaderCircle, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Lesson, Segment } from '@/lib/types';
import { hasKanji } from '@/lib/japanese-readings';
import {
  dictionaryTranslation,
  saveDictionary,
} from '@/lib/dictionary/client';
import { dictionarySource } from '@/lib/dictionary/source';
import { useAccount } from './account';

async function readingFor(term: string) {
  if (!hasKanji(term)) return null;
  try {
    const { japaneseReadings } = await import('@/lib/furigana-client');
    const tokens = await japaneseReadings(term);
    if (!tokens.some((token) => token.reading)) return null;
    return tokens.map((token) => token.reading ?? token.text).join('');
  } catch {
    return null;
  }
}

export function DictionarySavePanel({
  term,
  lesson,
  segment,
  sourceTranslation,
  onClose,
}: {
  term: string;
  lesson: Lesson;
  segment: Segment;
  sourceTranslation?: string;
  onClose: () => void;
}) {
  const account = useAccount();
  const [translation, setTranslation] = useState('');
  const [sentenceMeaning, setSentenceMeaning] = useState(sourceTranslation ?? '');
  const [reading, setReading] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTranslation('');
    setSentenceMeaning(sourceTranslation ?? '');
    setReading(null);
    setSaved(false);
    setError('');
    if (!account.user?.emailVerified || !term.trim()) return;
    const controller = new AbortController();
    setLoading(true);
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
              previousJapanese: lesson.segments[
                Math.max(0, lesson.segments.findIndex((value) => value.id === segment.id) - 1)
              ]?.japanese,
              nextJapanese:
                lesson.segments[
                  lesson.segments.findIndex((value) => value.id === segment.id) + 1
                ]?.japanese,
            },
            controller.signal,
          ),
      readingFor(term),
    ])
      .then(([termMeaning, sentence, termReading]) => {
        if (controller.signal.aborted) return;
        setTranslation(termMeaning);
        setSentenceMeaning(sentence);
        setReading(termReading);
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Translation is unavailable right now.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [account.user?.emailVerified, lesson, segment, sourceTranslation, term]);

  async function save() {
    if (!account.user?.emailVerified || !translation.trim() || !sentenceMeaning.trim()) return;
    setSaving(true);
    setError('');
    try {
      await saveDictionary({
        schemaVersion: 1,
        term: term.trim(),
        reading,
        translation: translation.trim(),
        sourceSentence: segment.japanese,
        sourceSentenceTranslation: sentenceMeaning.trim(),
        source: await dictionarySource(lesson, segment),
      });
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
          {reading ? <span className="dictionary-reading">{reading}</span> : null}
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
          {loading ? (
            <p className="dictionary-loading" role="status">
              <LoaderCircle className="spin" size={15} />
              Finding the meaning…
            </p>
          ) : (
            <div className="dictionary-fields">
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
          {error ? <p className="small dictionary-error" role="alert">{error}</p> : null}
          <div className="dictionary-save-actions">
            <button
              className="button primary"
              disabled={loading || saving || !translation.trim() || !sentenceMeaning.trim()}
              onClick={() => void save()}
            >
              <BookPlus size={15} />
              {saving ? 'Saving…' : saved ? 'Saved' : 'Save to dictionary'}
            </button>
            {saved ? (
              <Link className="text-button" href="/dictionary">
                View dictionary
              </Link>
            ) : null}
          </div>
          <p className="dictionary-privacy">
            Saving stores this selection, sentence, meanings, source identity and section timestamps
            in your account so it can be reviewed in context. Recordings are never included.
          </p>
        </>
      )}
    </aside>
  );
}
