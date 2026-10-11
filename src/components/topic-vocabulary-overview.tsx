'use client';
import Link from 'next/link';
import { BookPlus, Check, LoaderCircle, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Lesson } from '@/lib/types';
import { type TopicVocabularyAnalysis, type TopicVocabularyItem } from '@/lib/topic-vocabulary';
import { analyzeTopicVocabulary } from '@/lib/topic-vocabulary-client';
import { lookupJapanese } from '@/lib/lexicon/client';
import { dictionarySource } from '@/lib/dictionary/source';
import { markWords } from '@/lib/knowledge/client';
import { normalizeLemma } from '@/lib/knowledge/validation';
import { saveWordForReview } from '@/lib/vocabulary';
import { authPath } from '@/lib/auth/return-path';
import { DictionarySavePanel } from './dictionary-save';
import { ProFeatureNotice, useProAccess } from './pro-feature';
import { useAccount } from './account';
import { useWordKnowledge } from './use-word-knowledge';

function occurrenceLabel(item: TopicVocabularyItem) {
  const mentions = item.occurrences === 1 ? '1 mention' : `${item.occurrences} mentions`;
  const sections = item.sections === 1 ? '1 section' : `${item.sections} sections`;
  return `${mentions} · ${sections}`;
}

type Meaning = { gloss: string; reading?: string };

/** Key topic words of this video, with their meaning, ready to add to review. */
export function TopicVocabularyOverview({
  lesson,
  onReview,
}: {
  lesson: Lesson;
  onReview: (segmentIndex: number) => void;
}) {
  const { isPro } = useProAccess();
  const account = useAccount();
  const { states } = useWordKnowledge();
  const [analysis, setAnalysis] = useState<TopicVocabularyAnalysis | null>(null);
  const [meanings, setMeanings] = useState<Record<string, Meaning | null>>({});
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saveError, setSaveError] = useState('');
  const verified = !!account.user?.emailVerified;

  useEffect(() => {
    if (!isPro) return;
    const controller = new AbortController();
    void analyzeTopicVocabulary(lesson, controller.signal)
      .then(async (result) => {
        if (controller.signal.aborted) return;
        setAnalysis(result);
        // One lookup at a time: the dictionary shards are shared and cached.
        for (const item of result.items) {
          const segment = lesson.segments[item.representativeSegmentIndex];
          const meaning = await lookupJapanese(item.term, segment.japanese)
            .then((lexical): Meaning | null => {
              const match = lexical.matches[0];
              return match
                ? { gloss: match.senses[0].gloss.slice(0, 3).join('; '), reading: match.reading }
                : null;
            })
            .catch(() => null);
          if (controller.signal.aborted) return;
          setMeanings((current) => ({ ...current, [item.term]: meaning }));
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Essential vocabulary could not be analysed on this device.');
      });
    return () => controller.abort();
  }, [isPro, lesson]);

  async function addToReview(item: TopicVocabularyItem, meaning: Meaning) {
    if (saving) return;
    const segment = lesson.segments[item.representativeSegmentIndex];
    setSaving(item.term);
    setSaveError('');
    try {
      await saveWordForReview({
        schemaVersion: 1,
        term: item.term,
        reading: meaning.reading ?? item.reading ?? null,
        translation: meaning.gloss,
        sourceSentence: segment.japanese,
        sourceSentenceTranslation: segment.translation ?? '',
        source: await dictionarySource(lesson, segment),
      });
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Could not save this word.');
    } finally {
      setSaving(null);
    }
  }

  if (!isPro)
    return (
      <section className="topic-vocabulary-card" aria-labelledby="topic-vocabulary-heading">
        <div className="topic-vocabulary-heading">
          <div>
            <h2 id="topic-vocabulary-heading">Essential vocabulary</h2>
          </div>
        </div>
        <ProFeatureNotice feature="Essential vocabulary" />
      </section>
    );

  return (
    <section className="topic-vocabulary-card" aria-labelledby="topic-vocabulary-heading">
      <div className="topic-vocabulary-heading">
        <div>
          <h2 id="topic-vocabulary-heading">Essential vocabulary</h2>
          <p>The words this video is about, ranked by how often and how widely they come up.</p>
        </div>
        <span className="topic-vocabulary-local">Local · no AI</span>
      </div>

      {!analysis && !error ? (
        <p className="topic-vocabulary-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          Finding the words that define this video…
        </p>
      ) : null}

      {error ? (
        <p className="small muted" role="status">
          {error}
        </p>
      ) : null}

      {analysis && analysis.items.length === 0 ? (
        <p className="small muted">No words stand out strongly enough in this transcript.</p>
      ) : null}

      {analysis?.items.length ? (
        <ol className="topic-vocabulary-list">
          {analysis.items.map((item) => {
            const segment = lesson.segments[item.representativeSegmentIndex];
            const open = selected === item.term;
            const meaning = meanings[item.term];
            const reading = meaning?.reading ?? item.reading;
            const state = states[normalizeLemma(item.term)]?.state ?? 'unknown';
            return (
              <li className="topic-vocabulary-item" key={item.term}>
                <div className="topic-vocabulary-term">
                  <div>
                    <strong lang="ja">{item.term}</strong>
                    {reading && reading !== item.term ? <span lang="ja">{reading}</span> : null}
                    {state === 'learning' || state === 'known' ? (
                      <span className={`word-status ${state === 'learning' ? 'in-review' : ''}`}>
                        {state === 'learning' ? 'Learning' : 'Known'}
                      </span>
                    ) : null}
                  </div>
                  <span>{occurrenceLabel(item)}</span>
                </div>
                <p className="topic-vocabulary-meaning">
                  {meaning === undefined
                    ? 'Looking up…'
                    : (meaning?.gloss ??
                      'No dictionary entry. Look it up to add your own meaning.')}
                </p>
                <div className="topic-vocabulary-example">
                  <p lang="ja">{segment.japanese}</p>
                  {segment.translation ? <p>{segment.translation}</p> : null}
                </div>
                <div className="topic-vocabulary-actions">
                  {state === 'learning' ? null : meaning && verified ? (
                    <button
                      className="button small-button"
                      disabled={!!saving}
                      onClick={() => void addToReview(item, meaning)}
                    >
                      {saving === item.term ? (
                        <LoaderCircle className="spin" size={13} />
                      ) : (
                        <BookPlus size={13} />
                      )}
                      Add to review
                    </button>
                  ) : !account.user ? (
                    <Link
                      className="text-button"
                      href={authPath('/sign-in', `/practice/${encodeURIComponent(lesson.id)}`)}
                    >
                      Sign in to add to review
                    </Link>
                  ) : null}
                  {state === 'unknown' || state === 'ignored' ? (
                    <button
                      className="text-button"
                      onClick={() => {
                        try {
                          markWords([{ lemma: item.term, reading: reading ?? null }], 'known');
                        } catch (reason) {
                          setSaveError(
                            reason instanceof Error ? reason.message : 'Could not mark this word.',
                          );
                        }
                      }}
                    >
                      <Check size={13} />
                      Known
                    </button>
                  ) : null}
                  <button
                    className="text-button"
                    onClick={() => onReview(item.representativeSegmentIndex)}
                    aria-label={`Play ${item.term} in context`}
                  >
                    <Play size={13} />
                    Play in context
                  </button>
                  <button
                    className="text-button"
                    aria-expanded={open}
                    onClick={() => setSelected(open ? null : item.term)}
                  >
                    More meanings
                  </button>
                </div>
                {open ? (
                  <DictionarySavePanel
                    term={item.term}
                    lesson={lesson}
                    segment={segment}
                    sourceTranslation={segment.translation}
                    reading={reading ?? undefined}
                    onClose={() => setSelected(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      {saveError ? (
        <p className="error-message" role="alert">
          {saveError}
        </p>
      ) : null}
    </section>
  );
}
