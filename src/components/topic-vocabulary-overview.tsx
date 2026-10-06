'use client';
import { BookPlus, LoaderCircle, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Lesson } from '@/lib/types';
import { type TopicVocabularyAnalysis, type TopicVocabularyItem } from '@/lib/topic-vocabulary';
import { analyzeTopicVocabulary } from '@/lib/topic-vocabulary-client';
import { DictionarySavePanel } from './dictionary-save';
import { ProFeatureNotice, useProAccess } from './pro-feature';

function occurrenceLabel(item: TopicVocabularyItem) {
  const mentions = item.occurrences === 1 ? '1 mention' : `${item.occurrences} mentions`;
  const sections = item.sections === 1 ? '1 section' : `${item.sections} sections`;
  return `${mentions} · ${sections}`;
}

export function TopicVocabularyOverview({
  lesson,
  onReview,
}: {
  lesson: Lesson;
  onReview: (segmentIndex: number) => void;
}) {
  const { isPro } = useProAccess();
  const [analysis, setAnalysis] = useState<TopicVocabularyAnalysis | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!isPro) return;
    const controller = new AbortController();
    void analyzeTopicVocabulary(lesson, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setAnalysis(result);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('Topic vocabulary could not be analysed on this device.');
      });
    return () => controller.abort();
  }, [isPro, lesson]);

  if (!isPro)
    return (
      <section className="topic-vocabulary-card" aria-labelledby="topic-vocabulary-heading">
        <div className="topic-vocabulary-heading">
          <div>
            <span className="eyebrow">VIDEO OVERVIEW</span>
            <h2 id="topic-vocabulary-heading">Topic vocabulary</h2>
          </div>
        </div>
        <ProFeatureNotice feature="End-of-video topic vocabulary" />
      </section>
    );

  return (
    <section className="topic-vocabulary-card" aria-labelledby="topic-vocabulary-heading">
      <div className="topic-vocabulary-heading">
        <div>
          <span className="eyebrow">VIDEO OVERVIEW</span>
          <h2 id="topic-vocabulary-heading">Topic vocabulary</h2>
          <p>
            Words and phrases that stood out across this transcript, ranked by repetition, spread
            through the video and lexical specificity.
          </p>
        </div>
        <span className="topic-vocabulary-local">Local · no AI</span>
      </div>

      {!analysis && !error ? (
        <p className="topic-vocabulary-loading" role="status">
          <LoaderCircle className="spin" size={16} />
          Finding the vocabulary that defines this video…
        </p>
      ) : null}

      {error ? (
        <p className="small muted" role="status">
          {error}
        </p>
      ) : null}

      {analysis && analysis.items.length === 0 ? (
        <p className="small muted">
          No vocabulary passed the topic threshold strongly enough for this transcript.
        </p>
      ) : null}

      {analysis?.items.length ? (
        <ol className="topic-vocabulary-list">
          {analysis.items.map((item) => {
            const segment = lesson.segments[item.representativeSegmentIndex];
            const open = selected === item.term;
            return (
              <li className="topic-vocabulary-item" key={item.term}>
                <div className="topic-vocabulary-term">
                  <div>
                    <strong lang="ja">{item.term}</strong>
                    {item.reading && item.reading !== item.term ? (
                      <span lang="ja">{item.reading}</span>
                    ) : null}
                  </div>
                  <span>{occurrenceLabel(item)}</span>
                </div>
                <div className="topic-vocabulary-example">
                  <p lang="ja">{segment.japanese}</p>
                  {segment.translation ? <p>{segment.translation}</p> : null}
                </div>
                <div className="topic-vocabulary-actions">
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
                    <BookPlus size={13} />
                    Look up & save
                  </button>
                </div>
                {open ? (
                  <DictionarySavePanel
                    term={item.term}
                    lesson={lesson}
                    segment={segment}
                    sourceTranslation={segment.translation}
                    reading={item.reading ?? undefined}
                    onClose={() => setSelected(null)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      ) : null}

      <p className="topic-vocabulary-note">
        The ranking uses only words found in this transcript. It runs deterministically in your
        browser; recordings and learner history are not analysed.
      </p>
    </section>
  );
}
