import type { QuestionKind, QuizEvidence, QuizLesson, QuizQuestion, Segment } from '../types';
import { QuizValidationError, object, keys, text } from '../transcript-validation';
export const QUESTION_KINDS: QuestionKind[] = [
  'main-idea',
  'detail',
  'sequence',
  'vocabulary',
  'grammar',
  'reference',
  'intent',
  'inference',
];

// Evidence is always derived from normalized segments, never model timestamps.
export function mapEvidence(value: unknown, segments: Segment[]): QuizEvidence {
  const raw = object(value);
  keys(raw, ['segmentIds', 'quote', 'start', 'end']);
  if (!Array.isArray(raw.segmentIds) || !raw.segmentIds.length || raw.segmentIds.length > 24)
    throw new QuizValidationError('Evidence is required.');
  const segmentIds = raw.segmentIds.map((id) => text(id, 200));
  const first = segments.findIndex((s) => s.id === segmentIds[0]);
  const relevant = segments.slice(first, first + segmentIds.length);
  if (
    first < 0 ||
    relevant.length !== segmentIds.length ||
    relevant.some((s, i) => s.id !== segmentIds[i])
  )
    throw new QuizValidationError('Evidence must reference consecutive lesson sections.');
  const quote = relevant.map((s) => s.japanese).join('');
  // Providers only need to return grounded segment IDs; the application derives
  // canonical evidence text. Persisted/legacy quotes, when present, must still match.
  if (
    raw.quote !== undefined &&
    (typeof raw.quote !== 'string' || raw.quote.replace(/\s/g, '') !== quote.replace(/\s/g, ''))
  )
    throw new QuizValidationError('Evidence does not match this transcript.');
  const start = relevant[0].start,
    end = relevant.at(-1)!.end;
  if (
    (raw.start !== undefined && raw.start !== start) ||
    (raw.end !== undefined && raw.end !== end)
  )
    throw new QuizValidationError('Evidence timestamps do not match.');
  return { segmentIds, quote, start, end };
}

export function validateQuestion(
  value: unknown,
  index: number,
  lesson: QuizLesson,
  seen: Set<string>,
): QuizQuestion {
  const q = object(value);
  keys(q, ['id', 'kind', 'question', 'options', 'correctIndex', 'explanation', 'evidence']);
  if (!QUESTION_KINDS.includes(q.kind as QuestionKind))
    throw new QuizValidationError('Invalid question kind.');
  const question = text(q.question);
  if (seen.has(question)) throw new QuizValidationError('Duplicate question.');
  if (!Array.isArray(q.options) || q.options.length !== 4)
    throw new QuizValidationError('Four options are required.');
  const options = q.options.map((option) => text(option, 350));
  if (
    new Set(options.map((s) => s.normalize('NFKC').toLowerCase())).size !== 4 ||
    !Number.isInteger(q.correctIndex) ||
    (q.correctIndex as number) < 0 ||
    (q.correctIndex as number) >= 4
  )
    throw new QuizValidationError('Invalid answer options.');
  if (q.id !== undefined && q.id !== `question-${index + 1}`)
    throw new QuizValidationError('Invalid question ID.');
  const validated = {
    id: `question-${index + 1}`,
    kind: q.kind as QuestionKind,
    question,
    options,
    correctIndex: q.correctIndex as number,
    explanation: text(q.explanation, 1000),
    evidence: mapEvidence(q.evidence, lesson.segments),
  };
  seen.add(question);
  return validated;
}

export function validateQuestions(value: unknown, lesson: QuizLesson): QuizQuestion[] {
  const raw = object(value);
  keys(raw, ['questions']);
  if (!Array.isArray(raw.questions) || raw.questions.length < 3 || raw.questions.length > 7)
    throw new QuizValidationError('Expected three to seven questions.');
  const seen = new Set<string>();
  return raw.questions.map((value, i) => validateQuestion(value, i, lesson, seen));
}

// Model output is untrusted. Keep only individually strict, grounded questions and
// require at least three; this avoids failing an otherwise useful quiz because one
// candidate contains duplicate options or bad evidence. There is no regeneration loop.
export function filterGeneratedQuestions(
  value: unknown,
  lesson: QuizLesson,
  limit = 5,
): QuizQuestion[] {
  const raw = object(value);
  keys(raw, ['questions']);
  if (!Array.isArray(raw.questions) || raw.questions.length < 3 || raw.questions.length > 7)
    throw new QuizValidationError('Expected three to seven questions.');
  const accepted: QuizQuestion[] = [],
    seen = new Set<string>();
  for (const value of raw.questions) {
    if (accepted.length >= limit) break;
    try {
      const candidate = { ...object(value) };
      delete candidate.id;
      accepted.push(validateQuestion(candidate, accepted.length, lesson, seen));
    } catch (error) {
      if (!(error instanceof QuizValidationError)) throw error;
    }
  }
  if (accepted.length < 3)
    throw new QuizValidationError('Expected at least three valid questions.');
  return accepted;
}
