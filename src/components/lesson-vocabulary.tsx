'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Lesson } from '@/lib/types';
import { useLessonVocabulary, useWordKnowledge } from './use-word-knowledge';
import { JapaneseText } from './japanese-text';

export function LessonVocabulary({
  lesson,
  onPractice,
  onFilter,
  filterActive = false,
}: {
  lesson: Lesson;
  onPractice: (segmentId: string) => void;
  onFilter?: (segmentIds: string[] | null) => void;
  filterActive?: boolean;
}) {
  const { states } = useWordKnowledge();
  const [requested, setRequested] = useState(false);
  const enabled = requested || Object.keys(states).length > 0;
  const { analysis, loading, error } = useLessonVocabulary(lesson, enabled);
  const [filter, setFilter] = useState<'one' | 'value'>('one');
  const lines = analysis.sections.filter((section) =>
    filter === 'one' ? section.oneUnknown : section.highValue,
  );
  const lineIds = JSON.stringify(lines.map((line) => line.segmentId));
  useEffect(() => {
    if (filterActive && onFilter && !loading) onFilter(JSON.parse(lineIds));
  }, [filterActive, onFilter, lineIds, loading]);
  return (
    <section className="lesson-vocabulary" aria-label="Personal vocabulary coverage">
      <div className="vocabulary-heading">
        <div>
          <span className="eyebrow">ADAPTIVE IMMERSION</span>
          <h2>Your vocabulary in this lesson</h2>
        </div>
        <Link className="text-button" href="/words">
          Word Browser
        </Link>
      </div>
      {!enabled ? (
        <div>
          <p className="small muted">
            See vocabulary coverage and find short lines with one word to learn. Japanese analysis
            uses an optional 18 MB local dictionary download once per browser cache.
          </p>
          <button className="button small-button" onClick={() => setRequested(true)}>
            Analyse my vocabulary
          </button>
        </div>
      ) : loading ? (
        <p role="status">Analysing Japanese locally…</p>
      ) : error ? (
        <p role="status">{error}</p>
      ) : (
        <>
          <p>
            <strong>
              {analysis.knownPercent === null
                ? analysis.complete
                  ? 'No content words detected'
                  : 'Complete vocabulary coverage unavailable'
                : `${analysis.knownPercent}% marked Known`}
            </strong>
            {analysis.totalTokens && analysis.complete
              ? ` · ${analysis.knownTokens} of ${analysis.totalTokens} content-word occurrences`
              : ''}
          </p>
          {!analysis.complete ? (
            <p className="small muted">
              {analysis.analyzedSegments} of {analysis.segmentCount} sections analysed. A
              whole-lesson percentage is withheld when Japanese token boundaries are incomplete.
            </p>
          ) : null}
          <p className="small muted">
            Vocabulary coverage uses your explicit word states. Unmarked words count as Unknown;
            particles and auxiliary words are excluded, and Ignored words leave the denominator.
            This is a vocabulary estimate, not a comprehension score.
          </p>
          <div className="vocabulary-counts">
            <span>{analysis.learningTokens} Learning</span>
            <span>{analysis.unknownTokens} Unknown / unmarked</span>
            <span>{analysis.ignoredTokens} Ignored</span>
          </div>
          <div className="vocabulary-filters" aria-label="Good lines to learn">
            <button
              className="button small-button"
              aria-pressed={filter === 'one'}
              onClick={() => setFilter('one')}
            >
              One unknown word
            </button>
            <button
              className="button small-button"
              aria-pressed={filter === 'value'}
              onClick={() => setFilter('value')}
            >
              High-value lines
            </button>
          </div>
          {onFilter ? (
            <button
              className="text-button"
              disabled={!lines.length}
              onClick={() => onFilter(lines.map((line) => line.segmentId))}
            >
              Show these lines in transcript
            </button>
          ) : null}
          {lines.length ? (
            <ul className="good-lines">
              {lines.slice(0, 12).map((line) => {
                const segment = lesson.segments.find((value) => value.id === line.segmentId)!;
                return (
                  <li key={line.segmentId}>
                    <button className="good-line" onClick={() => onPractice(line.segmentId)}>
                      <span lang="ja">
                        <JapaneseText text={segment.japanese} />
                      </span>
                      <small>
                        {line.reason} · {Math.round(segment.end - segment.start)}s
                      </small>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="small muted">
              {filter === 'one'
                ? 'No clean lines with exactly one unmarked word yet. Mark the words you know to personalise this list.'
                : 'No suitable lines with recurring unmarked words yet. Recommendations favour words repeated in this lesson and lines with reliable short timing.'}
            </p>
          )}
          {lines.length > 12 ? (
            <p className="small muted">Showing the first 12 of {lines.length} suitable lines.</p>
          ) : null}
        </>
      )}
    </section>
  );
}
