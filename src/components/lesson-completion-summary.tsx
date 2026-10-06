'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import type { Lesson, QuizAttempt } from '@/lib/types';
import type {
  ShadowingAggregate,
  ShadowingScoreSession,
  ShadowingSessionSummary,
} from '@/lib/shadowing-session';
import { loadQuiz, loadQuizAttempt } from '@/lib/storage';
import { validateQuizLesson } from '@/lib/quiz';
import { completionRevisitSections } from '@/lib/lesson-completion';
import { dueReviews } from '@/lib/review-scheduler';
import { useReview } from './use-review';
import { useAccount } from './account';
import { ShadowingCompletion } from './shadowing-completion';
import { LessonReviewRecap } from './lesson-review-recap';
import { TopicVocabularyOverview } from './topic-vocabulary-overview';
import { ComprehensionQuiz } from './comprehension-quiz';
import { LessonDifficulty } from './lesson-difficulty';
export function LessonCompletionSummary({
  lesson,
  finished,
  scores,
  aggregate,
  summary,
  summaryLoading,
  onSummarize,
  onPracticeAgain,
  onReview,
  favorites,
  quiz,
  onDifficultyWaiting,
}: {
  lesson: Lesson;
  finished: boolean;
  scores: ShadowingScoreSession;
  aggregate: ShadowingAggregate | null;
  summary?: ShadowingSessionSummary;
  summaryLoading: boolean;
  onSummarize?: () => void;
  onPracticeAgain: () => void;
  onReview: (index: number) => void;
  favorites: string[];
  quiz: Omit<ComponentProps<typeof ComprehensionQuiz>, 'lesson' | 'onAttemptChange'> & {
    available: boolean;
  };
  onDifficultyWaiting: (waiting: boolean) => void;
}) {
  const account = useAccount(),
    review = useReview();
  const owner = account.user?.id ?? 'anonymous';
  const [result, setResult] = useState<{
    owner: string;
    attempt: QuizAttempt | null;
    key: string | null;
  } | null>(null);
  const attempt = result?.owner === owner ? result.attempt : null;
  useEffect(() => {
    let active = true;
    // Cache-only read: completion never generates a quiz.
    void loadQuiz(validateQuizLesson(lesson))
      .then((cached) => {
        if (active)
          setResult({
            owner,
            attempt: cached ? loadQuizAttempt(cached, validateQuizLesson(lesson)) : null,
            key: cached?.transcriptKey ?? null,
          });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [lesson, owner]);
  const revisit = completionRevisitSections(
    lesson,
    scores,
    attempt,
    favorites,
    result?.key ?? null,
  );
  return (
    <section
      className={finished ? 'lesson-completion-summary' : 'lesson-follow-up'}
      aria-label={finished ? 'Lesson completion summary' : 'Lesson follow-up'}
    >
      {finished ? (
        <>
          <header>
            <span className="eyebrow">KEEP WHAT YOU LEARNED</span>
            <h2>Lesson complete</h2>
            <p>{lesson.segments.length} sections completed</p>
          </header>
          <div className="completion-results">
            {aggregate ? (
              <div>
                <ShadowingCompletion
                  aggregate={aggregate}
                  summary={summary}
                  loading={summaryLoading}
                />
                {onSummarize && !summary ? (
                  <button className="text-button" disabled={summaryLoading} onClick={onSummarize}>
                    Summarise Shadowing Match
                  </button>
                ) : null}
              </div>
            ) : null}
            {attempt?.completedAt ? (
              <div className="completion-comprehension">
                <h3>Comprehension</h3>
                <strong>
                  {attempt.score} / {attempt.totalQuestions}
                </strong>
              </div>
            ) : null}
          </div>
          <LessonReviewRecap lesson={lesson} />
          {revisit.length ? (
            <div className="completion-revisit">
              <h3>Worth another listen</h3>
              <ul>
                {revisit.map((s) => (
                  <li key={s.index}>
                    <button className="text-button" onClick={() => onReview(s.index)}>
                      Section {s.index + 1}
                    </button>
                    <span className="small muted">{s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <TopicVocabularyOverview lesson={lesson} onReview={onReview} />
          <div className="completion-next">
            <div>
              <strong>
                {dueReviews(review.data.cards, new Date().toISOString()).length} reviews due
              </strong>
              <Link className="button primary" href="/review">
                Start Daily Review
              </Link>
            </div>
            <button className="button" onClick={onPracticeAgain}>
              Practice again
            </button>
            <Link className="text-button" href="/">
              Choose another lesson
            </Link>
          </div>
        </>
      ) : null}
      {quiz.available ? (
        <ComprehensionQuiz
          {...quiz}
          lesson={lesson}
          onAttemptChange={(attempt) => setResult({ owner, attempt, key: attempt.transcriptKey })}
        />
      ) : null}
      <LessonDifficulty lesson={lesson} onWaitingChange={onDifficultyWaiting} />
    </section>
  );
}
