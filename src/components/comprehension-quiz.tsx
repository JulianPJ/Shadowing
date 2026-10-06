'use client';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, RotateCcw } from 'lucide-react';
import type { Lesson, LessonQuiz, QuizAttempt, QuizEvidence } from '@/lib/types';
import { newAttempt, object, updateAttempt, validateQuiz, validateQuizLesson } from '@/lib/quiz';
import { loadQuiz, loadQuizAttempt, saveQuiz, saveQuizAttempt } from '@/lib/storage';
import { timestamp } from '@/lib/youtube';
import { JapaneseText } from './japanese-text';
import { postContentRequest } from '@/lib/content-request';
import { ProFeatureNotice, useProAccess } from './pro-feature';

type Props = {
  furigana?: boolean;
  lesson: Lesson;
  ready: boolean;
  recording: boolean;
  replaying: boolean;
  onReplay: (evidence: QuizEvidence) => void;
  onReturn: () => void;
  onOpenChange: (open: boolean) => void;
  onAttemptChange?: (attempt: QuizAttempt) => void;
};
export function ComprehensionQuiz({
  furigana = false,
  lesson,
  ready,
  recording,
  replaying,
  onReplay,
  onReturn,
  onOpenChange,
  onAttemptChange,
}: Props) {
  const { isPro } = useProAccess();
  const quizAvailable = isPro;
  const [quiz, setQuiz] = useState<LessonQuiz | null>(null);
  const [attempt, setAttempt] = useState<QuizAttempt | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [storageWarning, setStorageWarning] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (open && !loading) heading.current?.focus();
  }, [open, loading, questionIndex, attempt?.completedAt]);

  function persist(next: QuizAttempt, currentQuiz: LessonQuiz) {
    setAttempt(next);
    onAttemptChange?.(next);
    const saved = saveQuizAttempt(next, currentQuiz, lesson);
    setStorageWarning((current) => current || !saved);
  }
  async function start(retake = false) {
    if (loading) return;
    setOpen(true);
    onOpenChange(true);
    setLoading(true);
    setError('');
    setStorageWarning(false);
    const controller = new AbortController();
    abort.current?.abort();
    abort.current = controller;
    try {
      const input = validateQuizLesson(lesson);
      let currentQuiz = quiz || (await loadQuiz(input));
      if (!currentQuiz) {
        const response = await postContentRequest(
          '/api/quiz',
          lesson,
          input,
          controller.signal,
          40000,
        );
        let data: Record<string, unknown>;
        try {
          data = object(await response.json());
        } catch {
          throw new Error('We could not load a reliable check. Please try again.');
        }
        if (!response.ok)
          throw new Error(
            typeof data.error === 'string'
              ? data.error
              : 'This check is unavailable. Please try again.',
          );
        try {
          currentQuiz = await validateQuiz(data.quiz, input);
        } catch {
          throw new Error('We could not load a reliable check. Please try again.');
        }
        if (!saveQuiz(currentQuiz)) setStorageWarning(true);
      }
      if (controller.signal.aborted) return;
      const next = retake
        ? newAttempt(currentQuiz, input)
        : attempt || loadQuizAttempt(currentQuiz, input) || newAttempt(currentQuiz, input);
      setQuiz(currentQuiz);
      persist(next, currentQuiz);
      if (retake || !attempt)
        setQuestionIndex(
          next.completedAt ? 0 : Math.min(next.results.length, currentQuiz.questions.length - 1),
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error && error.name !== 'TimeoutError'
            ? error.message
            : 'The check took too long. Please try again.',
        );
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function close() {
    abort.current?.abort();
    setLoading(false);
    setOpen(false);
    onOpenChange(false);
  }
  const question = quiz?.questions[questionIndex];
  const result = attempt?.results[questionIndex];
  const completed = !!attempt?.completedAt;
  function answer(selected: number) {
    if (!quiz || !attempt || result || completed) return;
    const answers = [...attempt.results.map((r) => r.selectedIndex), selected];
    persist(updateAttempt(attempt, quiz, answers), quiz);
  }
  function finish() {
    if (!quiz || !attempt) return;
    persist(
      updateAttempt(
        attempt,
        quiz,
        attempt.results.map((r) => r.selectedIndex),
        true,
      ),
      quiz,
    );
  }
  if (!quizAvailable)
    return (
      <section id="lesson-quiz" className="quiz-card" aria-labelledby="quiz-title" tabIndex={-1}>
        <span className="eyebrow">ONE MORE MOMENT WITH THIS LESSON</span>
        <h2 id="quiz-title">Check your understanding</h2>
        <ProFeatureNotice feature="Generated comprehension checks" />
      </section>
    );

  return (
    <section id="lesson-quiz" className="quiz-card" aria-labelledby="quiz-title" tabIndex={-1}>
      <span className="eyebrow">ONE MORE MOMENT WITH THIS LESSON</span>
      <h2 id="quiz-title">Check your understanding</h2>
      {!open ? (
        <>
          <p>A few questions about what you just heard. Listen again to any supporting moment.</p>
          <button className="button primary" disabled={recording} onClick={() => void start()}>
            Take comprehension check
            <ArrowRight size={16} />
          </button>
          <p className="small muted">Optional · Your results stay on this device.</p>
          {lesson.source !== 'demo' ? (
            <p className="small muted">
              Preparing new questions sends this lesson’s Japanese transcript to the question
              service.
            </p>
          ) : null}
        </>
      ) : (
        <>
          <div className="quiz-toolbar">
            <span className="small muted">
              {quiz ? `${quiz.questions.length} questions · ${lesson.title}` : lesson.title}
            </span>
            <button className="text-button" onClick={close}>
              Back to practice
            </button>
          </div>
          {loading ? (
            <p className="quiz-loading" role="status">
              <LoaderCircle size={20} className="spin" />
              Preparing questions from your lesson…
            </p>
          ) : error ? (
            <div role="alert">
              <p>{error}</p>
              <p className="small muted">Your completed practice is still here.</p>
              <button className="button" onClick={() => void start()}>
                <RotateCcw size={16} />
                Retry comprehension check
              </button>
            </div>
          ) : quiz && attempt && question ? (
            <>
              {completed ? (
                <div className="quiz-summary" role="status">
                  <Check size={24} />
                  <div>
                    <strong>Comprehension check complete</strong>
                    <p>
                      {attempt.score} / {attempt.totalQuestions} correct
                    </p>
                    <p className="small muted">
                      {storageWarning
                        ? 'Results are available for this visit.'
                        : 'Result saved on this device.'}
                    </p>
                  </div>
                </div>
              ) : null}
              <p className="eyebrow">
                {completed ? 'REVIEW' : 'QUESTION'} {questionIndex + 1} / {quiz.questions.length}
              </p>
              <h3
                className="quiz-question"
                ref={heading}
                tabIndex={-1}
                lang="ja"
                aria-label={question.question}
              >
                <JapaneseText text={question.question} furigana={furigana} />
              </h3>
              <div className="quiz-options" role="group" aria-label="Answer options">
                {question.options.map((option, i) => (
                  <button
                    key={i}
                    className={`quiz-option ${result?.selectedIndex === i ? 'chosen' : ''} ${result && question.correctIndex === i ? 'correct' : ''}`}
                    disabled={!!result || completed}
                    onClick={() => answer(i)}
                  >
                    <span>{String.fromCharCode(65 + i)}</span>
                    <span lang="ja">
                      <JapaneseText text={option} furigana={furigana} />
                    </span>
                    {result && question.correctIndex === i ? (
                      <Check size={16} aria-label="Correct answer" />
                    ) : null}
                    {result?.selectedIndex === i ? (
                      <span className="small">Your answer</span>
                    ) : null}
                  </button>
                ))}
              </div>
              {result ? (
                <div className="quiz-feedback" role="status">
                  <strong>{result.correct ? 'Correct.' : 'Not quite.'}</strong>
                  <p>{question.explanation}</p>
                  <blockquote lang="ja">
                    <JapaneseText text={question.evidence.quote} furigana={furigana} />
                  </blockquote>
                  <p className="small muted">
                    {timestamp(question.evidence.start)} – {timestamp(question.evidence.end)}
                    {lesson.segments.some(
                      (s) => question.evidence.segmentIds.includes(s.id) && s.estimated,
                    )
                      ? ' · Approximate segment timing'
                      : ''}
                  </p>
                  <button
                    className="button primary quiz-replay"
                    disabled={!ready || recording}
                    onClick={() => onReplay(question.evidence)}
                  >
                    <RotateCcw size={17} />
                    Replay relevant section
                  </button>
                  {!ready ? (
                    <p className="small muted">
                      Reattach your media or wait for the player to listen again.
                    </p>
                  ) : null}
                </div>
              ) : null}
              {replaying ? (
                <div className="quiz-return">
                  <p>Listening to the evidence. Your answer is kept.</p>
                  <button className="button" onClick={onReturn}>
                    Return to question
                    <ArrowRight size={16} />
                  </button>
                </div>
              ) : null}
              <div className="quiz-actions">
                {completed ? (
                  <>
                    <button
                      className="button"
                      disabled={questionIndex === 0}
                      onClick={() => setQuestionIndex((n) => n - 1)}
                    >
                      Previous question
                    </button>
                    <button
                      className="button"
                      disabled={questionIndex === quiz.questions.length - 1}
                      onClick={() => setQuestionIndex((n) => n + 1)}
                    >
                      Next question
                    </button>
                    <button className="text-button" onClick={() => void start(true)}>
                      Try the check again
                    </button>
                  </>
                ) : result ? (
                  questionIndex === quiz.questions.length - 1 ? (
                    <button className="button primary" onClick={finish}>
                      Finish comprehension check
                      <Check size={16} />
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => setQuestionIndex((n) => n + 1)}
                    >
                      Next question
                      <ArrowRight size={16} />
                    </button>
                  )
                ) : (
                  <p className="small muted">Choose the answer that fits this lesson.</p>
                )}
              </div>
            </>
          ) : (
            <p role="status">There are no questions to show yet. Try this check again.</p>
          )}
          {storageWarning ? (
            <p className="small error-message" role="alert">
              This browser could not save your check. You can finish here, but the result may be
              lost when you leave.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
