'use client';
import Link from 'next/link';
import { BookPlus, LoaderCircle, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { Lesson, Segment } from '@/lib/types';
import { dictionaryTranslation, saveDictionary } from '@/lib/dictionary/client';
import { dictionarySource } from '@/lib/dictionary/source';
import { lookupJapanese } from '@/lib/lexicon/client';
import type { LexiconResult } from '@/lib/lexicon/types';
import { useAccount } from './account';
import type { DictionaryEntry } from '@/lib/dictionary/types';
import { acknowledgeReviewConflict, changeReview } from '@/lib/review/client';
import { LexiconDefinitions } from './lexicon-definitions';
import { WordStateControls } from './word-state-controls';
import { useReview } from './use-review';
import { storageAccount } from '@/lib/storage/browser';
import { syncStatus } from '@/lib/sync/client';
import { changeTags, listTags } from '@/lib/tags/client';
import { tagName } from '@/lib/tags/validation';
import type { Tag } from '@/lib/tags/types';
import { authPath } from '@/lib/auth/return-path';

export function DictionarySavePanel({
  term,
  lesson,
  segment,
  sourceTranslation,
  reading,
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
      key={`${account.user?.id ?? 'anonymous'}:${segment.id}:${term}`}
      term={term}
      lesson={lesson}
      segment={segment}
      sourceTranslation={sourceTranslation}
      reading={reading}
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
  const review = useReview();
  const [translation, setTranslation] = useState('');
  const [reading, setReading] = useState(initialReading ?? '');
  const [lemma, setLemma] = useState(term.trim());
  const [sentenceMeaning, setSentenceMeaning] = useState(sourceTranslation ?? '');
  const [result, setResult] = useState<LexiconResult | null>(null);
  const [selectedSense, setSelectedSense] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [lookupAttempt, setLookupAttempt] = useState(0);
  const [sentenceAttempt, setSentenceAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedEntry, setSavedEntry] = useState<DictionaryEntry | null>(null);
  const [savedMode, setSavedMode] = useState<'study' | 'only' | null>(null);
  const [deckId, setDeckId] = useState('inbox');
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [error, setError] = useState('');
  const [lexiconError, setLexiconError] = useState('');
  const [sentenceError, setSentenceError] = useState('');
  const busy = useRef(false);
  const meaningTouched = useRef(false);
  const senseTouched = useRef(false);
  const readingTouched = useRef(!!initialReading);
  const sentenceTouched = useRef(false);
  const createdTag = useRef<{ name: string; id: string } | null>(null);
  const panel = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const tagListId = useId();
  const deckAvailable = deckId === 'inbox' || review.data.decks.some((deck) => deck.id === deckId);
  const selectedDeck =
    review.data.decks.find((deck) => deck.id === deckId)?.name ??
    (deckId === 'inbox' ? 'Inbox' : 'Unavailable deck');
  const inDeck =
    !!savedEntry &&
    review.data.memberships.some(
      (membership) => membership.entryId === savedEntry.id && membership.deckId === deckId,
    );
  const readyToStudy =
    savedMode === 'study' &&
    deckAvailable &&
    inDeck &&
    review.data.cards.some(
      (card) => card.entryId === savedEntry?.id && card.status !== 'suspended',
    );
  const savedInDeck = !!savedMode && deckAvailable && inDeck;

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
        if (!senseTouched.current) setLemma(match?.lemma ?? lexical.lemma);
        if (!meaningTouched.current) {
          if (match) {
            setTranslation(match.senses[0].gloss.join('; ').slice(0, 1000));
            setSelectedSense(`${match.entry.id}:${match.lemma}:${match.reading}:0`);
          }
        }
        if (match && !readingTouched.current) setReading(match.reading);
        if (!match && !meaningTouched.current && account.user?.emailVerified) {
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
  }, [term, segment.japanese, account.user?.id, account.user?.emailVerified, lookupAttempt]);

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
        if (!controller.signal.aborted && !sentenceTouched.current) setSentenceMeaning(sentence);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSentenceError(
            'Sentence translation is unavailable. You can save the Japanese context now.',
          );
      });
    return () => controller.abort();
  }, [
    account.user?.id,
    account.user?.emailVerified,
    lesson,
    segment,
    sourceTranslation,
    sentenceAttempt,
  ]);

  useEffect(() => {
    if (!account.user?.emailVerified) return;
    let active = true;
    void listTags()
      .then((values) => {
        if (active) setTags(values);
      })
      .catch(() => {
        /* Optional tags never block vocabulary saving. */
      });
    return () => {
      active = false;
    };
  }, [account.user?.id, account.user?.emailVerified]);

  const editEntry = () => {
    setSavedEntry(null);
    setSavedMode(null);
    setError('');
  };

  async function save(mode: 'study' | 'only') {
    if (busy.current || !account.user?.emailVerified || !translation.trim() || !deckAvailable)
      return;
    busy.current = true;
    setSaving(true);
    setError('');
    const owner = account.user.id;
    const current = () => storageAccount() === owner && syncStatus().user?.id === owner;
    let entry = savedEntry;
    try {
      const tag = tagInput.trim() ? tagName(tagInput) : null;
      if (!entry) {
        const source = await dictionarySource(lesson, segment);
        if (!current()) return;
        entry = await saveDictionary({
          schemaVersion: 1,
          term: lemma,
          reading: reading.trim() || null,
          translation: translation.trim(),
          sourceSentence: segment.japanese,
          sourceSentenceTranslation: sentenceMeaning.trim(),
          source,
        });
        if (!current()) return;
        setSavedEntry(entry);
      }
      if (!current()) return;
      if (tag) {
        let id = tags.find((value) => value.normalizedName === tag.normalizedName)?.id;
        if (!id) {
          if (createdTag.current?.name !== tag.normalizedName)
            createdTag.current = { name: tag.normalizedName, id: crypto.randomUUID() };
          id = createdTag.current.id;
          try {
            await changeTags({ action: 'create', id, name: tag.name });
          } catch (reason) {
            // A concurrent create or an interrupted response may already have made the tag.
            const latest = await listTags();
            if (!current()) return;
            setTags(latest);
            const existing = latest.find((value) => value.normalizedName === tag.normalizedName);
            if (!existing) throw reason;
            id = existing.id;
          }
        }
        if (!current()) return;
        await changeTags({ action: 'membership', tagId: id, entryIds: [entry.id], remove: false });
      }
      if (!current()) return;
      if (review.conflict) acknowledgeReviewConflict();
      changeReview(
        mode === 'study'
          ? { action: 'enroll', entryIds: [entry.id], deckId, enrolledAt: new Date().toISOString() }
          : { action: 'membership', entryIds: [entry.id], deckId, remove: false },
      );
      setSavedMode(mode);
    } catch (reason) {
      if (current())
        setError(
          `${entry ? 'The word is saved. ' : ''}${reason instanceof Error ? reason.message : 'Could not finish saving this vocabulary.'} Retry below.`,
        );
    } finally {
      busy.current = false;
      setSaving(false);
    }
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
          <span className="eyebrow">JAPANESE DICTIONARY</span>
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
          Finding the dictionary meaning…
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
            editEntry();
          }}
        />
      ) : null}
      {lexiconError ? (
        <div className="dictionary-lookup-error" role="status">
          <p>{lexiconError} You can enter a meaning below.</p>
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
      <WordStateControls lemma={lemma} reading={reading || null} />
      <div className="dictionary-context">
        <span>Original sentence</span>
        <p lang="ja">{segment.japanese}</p>
        {sentenceMeaning ? (
          <p>{sentenceMeaning}</p>
        ) : (
          <p className="small muted">
            Japanese context will be saved. Sentence translation is optional; choose the sense that
            fits this speaker.
          </p>
        )}
      </div>
      {!account.user ? (
        <div className="dictionary-signin">
          <p>
            Dictionary lookup and word states are Free and work on this device. Sign in to save
            source-linked vocabulary and study it later.
          </p>
          <Link
            className="button primary"
            href={authPath(
              '/sign-in',
              `/practice/${encodeURIComponent(lesson.id)}?section=${encodeURIComponent(segment.id)}&lookup=${encodeURIComponent(term)}`,
            )}
          >
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
                maxLength={240}
                disabled={saving}
                onChange={(event) => {
                  readingTouched.current = true;
                  setReading(event.target.value);
                  editEntry();
                }}
              />
            </label>
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
                  editEntry();
                }}
              />
            </label>
            <label>
              Sentence meaning (optional)
              <textarea
                aria-label="Source sentence meaning"
                rows={2}
                maxLength={10000}
                value={sentenceMeaning}
                disabled={saving}
                onChange={(event) => {
                  sentenceTouched.current = true;
                  setSentenceMeaning(event.target.value);
                  editEntry();
                }}
              />
            </label>
            {sentenceError ? (
              <p className="small muted" role="status">
                {sentenceError}{' '}
                <button
                  className="text-button"
                  disabled={saving}
                  onClick={() => {
                    setSentenceError('');
                    setSentenceAttempt((value) => value + 1);
                  }}
                >
                  Retry sentence translation
                </button>
              </p>
            ) : null}
            <label>
              Deck
              <select
                aria-label="Save vocabulary to deck"
                value={deckId}
                disabled={saving}
                onChange={(event) => {
                  setDeckId(event.target.value);
                  setSavedMode(null);
                }}
              >
                <option value="inbox">Inbox · default collection</option>
                {!deckAvailable ? (
                  <option value={deckId} disabled>
                    Deck unavailable · choose another
                  </option>
                ) : null}
                {review.data.decks
                  .filter((deck) => deck.id !== 'inbox')
                  .map((deck) => (
                    <option key={deck.id} value={deck.id}>
                      {deck.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Add tag (optional)
              <input
                aria-label="Vocabulary tag"
                list={tagListId}
                value={tagInput}
                maxLength={64}
                disabled={saving}
                placeholder="Choose or create a tag"
                onChange={(event) => {
                  setTagInput(event.target.value);
                  setSavedMode(null);
                }}
              />
              <datalist id={tagListId}>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.name} />
                ))}
              </datalist>
              <span className="small muted">
                Choose an existing tag or type a new name. Tags describe words.
              </span>
            </label>
          </div>
          {error ? (
            <p className="dictionary-error" role="alert">
              {error}
            </p>
          ) : null}
          {savedEntry && (review.conflict || review.error || !deckAvailable) ? (
            <p className="dictionary-error" role="alert">
              The word is saved.{' '}
              {review.conflict ||
                review.error ||
                'This deck is no longer available. Choose another deck below.'}{' '}
              <button
                className="text-button"
                disabled={saving}
                onClick={() => {
                  acknowledgeReviewConflict();
                  void review
                    .refresh()
                    .catch((reason) =>
                      setError(
                        reason instanceof Error ? reason.message : 'Could not refresh study.',
                      ),
                    );
                }}
              >
                Refresh study status
              </button>
            </p>
          ) : null}
          <div className="dictionary-save-actions">
            <button
              className="button primary"
              disabled={saving || !translation.trim() || !deckAvailable || readyToStudy}
              onClick={() => void save('study')}
            >
              <BookPlus size={15} />
              {saving
                ? 'Saving…'
                : readyToStudy
                  ? 'Saved and ready to study'
                  : savedEntry
                    ? 'Add saved word to study'
                    : 'Save and study'}
            </button>
            <button
              className="button small-button"
              disabled={saving || !translation.trim() || !deckAvailable || savedInDeck}
              onClick={() => void save('only')}
            >
              Save only
            </button>
            {savedEntry ? (
              <Link className="text-button" href="/dictionary">
                View saved words
              </Link>
            ) : null}
            {readyToStudy ? (
              <Link className="text-button" href={`/review?deck=${encodeURIComponent(deckId)}`}>
                Study this deck
              </Link>
            ) : null}
          </div>
          <p className="dictionary-privacy" role="status">
            {savedInDeck
              ? `Saved in ${selectedDeck}. ${readyToStudy ? 'Ready to study. ' : savedMode === 'only' ? 'Saved for reference; no new review card was added. ' : 'Study enrollment needs attention. '}${review.pending ? 'Deck and study changes are saved on this device, waiting to sync. ' : ''}`
              : ''}
            Saving keeps the dictionary form, chosen meaning and exact Japanese source context. Your
            word knowledge changes only when you mark it.
          </p>
        </>
      )}
    </aside>
  );
}
