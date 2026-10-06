'use client';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  calculateSpeechSpeed,
  validateDifficultyAnalysis,
  validateDifficultyLesson,
} from '@/lib/difficulty';
import { object, transcriptRevision } from '@/lib/quiz';
import { loadDifficulty, saveDifficulty } from '@/lib/storage';
import type { ContentDifficultyAnalysis, Lesson } from '@/lib/types';
import { postContentRequest } from '@/lib/content-request';

export const LessonDifficulty = memo(function LessonDifficulty({
  lesson,
  onWaitingChange,
}: {
  lesson: Lesson;
  onWaitingChange?: (waiting: boolean) => void;
}) {
  return (
    <DifficultyCard
      key={`${lesson.id}:${transcriptRevision(lesson)}`}
      lesson={lesson}
      onWaitingChange={onWaitingChange}
    />
  );
});
function DifficultyCard({
  lesson,
  onWaitingChange,
}: {
  lesson: Lesson;
  onWaitingChange?: (waiting: boolean) => void;
}) {
  const [analysis, setAnalysis] = useState<ContentDifficultyAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [checkingCache, setCheckingCache] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const initialLesson = useRef(lesson);
  const speech = analysis?.speechSpeed || calculateSpeechSpeed(lesson.segments);
  const insufficient = speech.japaneseCharacters < 40 || lesson.segments.length < 2;
  useEffect(() => {
    let active = true;
    void loadDifficulty(initialLesson.current).then((cached) => {
      if (active) {
        setAnalysis(cached);
        setCheckingCache(false);
      }
    });
    return () => {
      active = false;
      abort.current?.abort();
    };
  }, []);
  const analyze = useCallback(async () => {
    if (busy.current || checkingCache || analysis) return;
    busy.current = true;
    setLoading(true);
    setError('');
    onWaitingChange?.(true);
    const controller = new AbortController();
    abort.current = controller;
    const unavailable = 'Difficulty analysis is unavailable right now. Please try again.';
    try {
      let input;
      try {
        input = validateDifficultyLesson(lesson);
      } catch {
        throw new Error(
          'This transcript cannot support difficulty analysis. You can keep practicing.',
        );
      }
      const response = await postContentRequest(
        '/api/difficulty',
        lesson,
        input,
        controller.signal,
        35000,
      );
      const data = object(await response.json());
      if (!response.ok)
        throw new Error(
          data.code === 'insufficient-transcript'
            ? 'There is not enough Japanese transcript for a useful estimate.'
            : data.code === 'malformed'
              ? 'We could not make a reliable difficulty estimate. Please try again.'
              : unavailable,
        );
      let next;
      try {
        next = await validateDifficultyAnalysis(data.analysis, input);
      } catch {
        throw new Error('We could not make a reliable difficulty estimate. Please try again.');
      }
      if (controller.signal.aborted) return;
      setStorageWarning(!(await saveDifficulty(next, input)));
      if (!controller.signal.aborted) setAnalysis(next);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error &&
            [
              'There is not enough',
              'This transcript',
              'We could not',
              'Difficulty analysis is unavailable',
            ].some((prefix) => error.message.startsWith(prefix))
            ? error.message
            : unavailable,
        );
    } finally {
      busy.current = false;
      if (!controller.signal.aborted) {
        setLoading(false);
        onWaitingChange?.(false);
      }
    }
  }, [analysis, checkingCache, lesson, onWaitingChange]);
  useEffect(() => {
    if (!checkingCache && !analysis && !insufficient) void analyze();
  }, [analysis, analyze, checkingCache, insufficient]);

  const dimensions = analysis
    ? [
        { title: 'Vocabulary', value: analysis.vocabulary.label },
        { title: 'Grammar', value: analysis.grammar.label },
        { title: 'Speech', value: speech.label },
        { title: 'Conversation', value: analysis.conversationalComplexity.label },
      ]
    : [];
  return (
    <section
      className="difficulty-card"
      aria-labelledby="difficulty-title"
      data-testid="lesson-difficulty"
    >
      <div className="difficulty-heading">
        <h2 id="difficulty-title">Estimated content difficulty</h2>
        <span className="small muted">Content only</span>
      </div>
      {analysis ? (
        <>
          <dl className="difficulty-summary">
            <div>
              <dt>Approx. level</dt>
              <dd>{analysis.overall.label.replace('Approximately ', '')}</dd>
            </div>
            {dimensions.map((d) => (
              <div key={d.title}>
                <dt>{d.title}</dt>
                <dd>{d.value}</dd>
              </div>
            ))}
          </dl>
          <p className="small muted">
            Classification uses the full Japanese transcript where it fits in one decision request,
            with full-coverage chunking for larger scripts. Speech pace is calculated from caption
            timing.
          </p>
          {storageWarning ? (
            <p className="small" role="status">
              This browser could not save the estimate. It is available for this visit.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <p className="difficulty-pace">
            <span>Speech · </span>
            {speech.label}
            <span className="small muted"> · Estimated from captions</span>
          </p>
          <p className="small muted">
            Hibiki estimates the language demands automatically. This is an approximate guide,
            not an official JLPT classification.
          </p>
          <button
            className="button difficulty-toggle"
            disabled={checkingCache || loading || insufficient}
            onClick={() => void analyze()}
          >
            {loading
              ? 'Estimating difficulty…'
              : error
                ? 'Retry difficulty analysis'
                : 'Estimate difficulty'}
          </button>
          {insufficient ? (
            <p className="small muted">Not enough Japanese transcript for a useful estimate.</p>
          ) : (
            <p className="small muted">
              The semantic classifier receives only the Japanese transcript. The result stays on
              this device.
            </p>
          )}
        </>
      )}
      {loading ? (
        <p role="status" className="small muted">
          Estimating the language demands… You can keep practicing.
        </p>
      ) : null}
      {error ? (
        <p role="alert">{error} Your practice and comprehension check remain available.</p>
      ) : null}
    </section>
  );
}
