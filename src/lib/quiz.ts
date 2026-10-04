import type { LessonQuiz, QuestionKind, QuizAttempt, QuizEvidence, QuizLesson, QuizQuestion, Segment } from './types';

export const QUESTION_KINDS: QuestionKind[] = ['main-idea', 'detail', 'sequence', 'vocabulary', 'grammar', 'reference', 'intent', 'inference'];
export class QuizValidationError extends Error {}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new QuizValidationError('Expected an object.');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new QuizValidationError('Unexpected fields.');
}
function text(value: unknown, max = 600): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new QuizValidationError('Invalid text.');
  return value.trim();
}
export function validateQuizLesson(value: unknown, limits = { maxSegments: 2000, maxCharacters: 60000 }): QuizLesson {
  const raw = object(value);
  const id = text(raw.id, 200);
  const videoId = raw.videoId === undefined ? undefined : text(raw.videoId, 100);
  if (!Array.isArray(raw.segments) || !raw.segments.length || raw.segments.length > limits.maxSegments) throw new QuizValidationError('A supported transcript is required.');
  const ids = new Set<string>();
  let previousEnd = 0;
  const segments: Segment[] = raw.segments.map(value => {
    const s = object(value);
    const id = text(s.id, 200);
    if (ids.has(id) || typeof s.start !== 'number' || typeof s.end !== 'number' || !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start < previousEnd || s.end <= s.start || s.end > 86400) throw new QuizValidationError('Invalid normalized segments.');
    ids.add(id); previousEnd = s.end;
    return { id, start: s.start, end: s.end, japanese: text(s.japanese, 5000) };
  });
  if (segments.reduce((n, s) => n + s.japanese.length, 0) > limits.maxCharacters) throw new QuizValidationError(limits.maxCharacters === 60000 ? 'This transcript is too long for a short comprehension check.' : 'This transcript is too long for analysis.');
  return { id, ...(videoId ? { videoId } : {}), segments };
}
export function transcriptRevision(lesson: QuizLesson): string {
  return JSON.stringify(lesson.segments.map(s => [s.id, s.start, s.end, s.japanese.trim()]));
}
export async function transcriptKey(lesson: QuizLesson): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(transcriptRevision(lesson)));
  return Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('');
}
// Evidence is always derived from normalized segments, never model timestamps.
export function mapEvidence(value: unknown, segments: Segment[]): QuizEvidence {
  const raw = object(value);
  keys(raw, ['segmentIds', 'quote', 'start', 'end']);
  if (!Array.isArray(raw.segmentIds) || !raw.segmentIds.length || raw.segmentIds.length > 24) throw new QuizValidationError('Evidence is required.');
  const segmentIds = raw.segmentIds.map(id => text(id, 200));
  const first = segments.findIndex(s => s.id === segmentIds[0]);
  const relevant = segments.slice(first, first + segmentIds.length);
  if (first < 0 || relevant.length !== segmentIds.length || relevant.some((s, i) => s.id !== segmentIds[i])) throw new QuizValidationError('Evidence must reference consecutive lesson sections.');
  const quote = relevant.map(s => s.japanese).join('');
  // Providers only need to return grounded segment IDs; the application derives
  // canonical evidence text. Persisted/legacy quotes, when present, must still match.
  if (raw.quote !== undefined && (typeof raw.quote !== 'string' || raw.quote.replace(/\s/g, '') !== quote.replace(/\s/g, ''))) throw new QuizValidationError('Evidence does not match this transcript.');
  const start = relevant[0].start, end = relevant.at(-1)!.end;
  if ((raw.start !== undefined && raw.start !== start) || (raw.end !== undefined && raw.end !== end)) throw new QuizValidationError('Evidence timestamps do not match.');
  return { segmentIds, quote, start, end };
}
export function validateQuestions(value: unknown, lesson: QuizLesson): QuizQuestion[] {
  const raw = object(value); keys(raw, ['questions']);
  if (!Array.isArray(raw.questions) || raw.questions.length < 3 || raw.questions.length > 7) throw new QuizValidationError('Expected three to seven questions.');
  const seen = new Set<string>();
  return raw.questions.map((value, i) => {
    const q = object(value); keys(q, ['id', 'kind', 'question', 'options', 'correctIndex', 'explanation', 'evidence']);
    if (!QUESTION_KINDS.includes(q.kind as QuestionKind)) throw new QuizValidationError('Invalid question kind.');
    const question = text(q.question);
    if (seen.has(question)) throw new QuizValidationError('Duplicate question.'); seen.add(question);
    if (!Array.isArray(q.options) || q.options.length !== 4) throw new QuizValidationError('Four options are required.');
    const options = q.options.map(option => text(option, 350));
    if (new Set(options.map(s => s.normalize('NFKC').toLowerCase())).size !== 4 || !Number.isInteger(q.correctIndex) || (q.correctIndex as number) < 0 || (q.correctIndex as number) >= 4) throw new QuizValidationError('Invalid answer options.');
    if (q.id !== undefined && q.id !== `question-${i + 1}`) throw new QuizValidationError('Invalid question ID.');
    return { id: `question-${i + 1}`, kind: q.kind as QuestionKind, question, options, correctIndex: q.correctIndex as number, explanation: text(q.explanation, 1000), evidence: mapEvidence(q.evidence, lesson.segments) };
  });
}
export async function createQuiz(value: unknown, lesson: QuizLesson): Promise<LessonQuiz> {
  return { schemaVersion: 1, id: crypto.randomUUID(), lessonId: lesson.id, transcriptKey: await transcriptKey(lesson), generatedAt: new Date().toISOString(), questions: validateQuestions(value, lesson) };
}
function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new QuizValidationError('Invalid date.');
  return value;
}
export async function validateQuiz(value: unknown, lesson: QuizLesson): Promise<LessonQuiz> {
  const raw = object(value); keys(raw, ['schemaVersion', 'id', 'lessonId', 'transcriptKey', 'generatedAt', 'questions']);
  if (raw.schemaVersion !== 1 || raw.lessonId !== lesson.id || raw.transcriptKey !== await transcriptKey(lesson)) throw new QuizValidationError('This quiz belongs to a different transcript.');
  return { schemaVersion: 1, id: text(raw.id, 200), lessonId: lesson.id, transcriptKey: raw.transcriptKey as string, generatedAt: isoDate(raw.generatedAt), questions: validateQuestions({ questions: raw.questions }, lesson) };
}
export function scoreQuiz(quiz: LessonQuiz, answers: number[]) {
  if (!Array.isArray(answers) || answers.length > quiz.questions.length) throw new QuizValidationError('Invalid answers.');
  const results = answers.map((selectedIndex, i) => {
    const q = quiz.questions[i];
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= q.options.length) throw new QuizValidationError('Invalid selected option.');
    return { questionId: q.id, kind: q.kind, selectedIndex, correctIndex: q.correctIndex, correct: selectedIndex === q.correctIndex, evidence: q.evidence };
  });
  return { results, score: results.filter(r => r.correct).length, totalQuestions: quiz.questions.length };
}
export function newAttempt(quiz: LessonQuiz, lesson: QuizLesson): QuizAttempt {
  const now = new Date().toISOString();
  return { schemaVersion: 1, id: crypto.randomUUID(), lessonId: lesson.id, ...(lesson.videoId ? { videoId: lesson.videoId } : {}), quizId: quiz.id, transcriptKey: quiz.transcriptKey, quizAttempted: true, startedAt: now, updatedAt: now, completedAt: null, ...scoreQuiz(quiz, []) };
}
export function updateAttempt(attempt: QuizAttempt, quiz: LessonQuiz, answers: number[], finish = false): QuizAttempt {
  const scored = scoreQuiz(quiz, answers);
  if (finish && answers.length !== quiz.questions.length) throw new QuizValidationError('Answer every question before finishing.');
  const now = new Date().toISOString();
  return { ...attempt, ...scored, updatedAt: now, completedAt: finish ? now : null };
}
export function validateAttempt(value: unknown, quiz: LessonQuiz, lesson: QuizLesson): QuizAttempt {
  const raw = object(value);
  keys(raw, ['schemaVersion', 'id', 'lessonId', 'videoId', 'quizId', 'transcriptKey', 'quizAttempted', 'startedAt', 'updatedAt', 'completedAt', 'score', 'totalQuestions', 'results']);
  if (raw.schemaVersion !== 1 || raw.quizAttempted !== true || raw.lessonId !== lesson.id || raw.videoId !== lesson.videoId || raw.quizId !== quiz.id || raw.transcriptKey !== quiz.transcriptKey || !Array.isArray(raw.results)) throw new QuizValidationError('Invalid attempt.');
  const scored = scoreQuiz(quiz, raw.results.map(r => object(r).selectedIndex as number));
  if (raw.score !== scored.score || raw.totalQuestions !== scored.totalQuestions) throw new QuizValidationError('Invalid stored score.');
  raw.results.forEach((value, i) => {
    const r = object(value), expected = scored.results[i];
    keys(r, ['questionId', 'kind', 'selectedIndex', 'correctIndex', 'correct', 'evidence']);
    if (r.questionId !== expected.questionId || r.kind !== expected.kind || r.correctIndex !== expected.correctIndex || r.correct !== expected.correct || JSON.stringify(mapEvidence(r.evidence, lesson.segments)) !== JSON.stringify(expected.evidence)) throw new QuizValidationError('Invalid stored result.');
  });
  const startedAt = isoDate(raw.startedAt), updatedAt = isoDate(raw.updatedAt);
  const completedAt = raw.completedAt === null ? null : isoDate(raw.completedAt);
  if (updatedAt < startedAt || (completedAt && (scored.results.length !== quiz.questions.length || completedAt < startedAt || completedAt > updatedAt))) throw new QuizValidationError('Invalid completion.');
  return { schemaVersion: 1, id: text(raw.id, 200), lessonId: lesson.id, ...(lesson.videoId ? { videoId: lesson.videoId } : {}), quizId: quiz.id, transcriptKey: quiz.transcriptKey, quizAttempted: true, startedAt, updatedAt, completedAt, ...scored };
}
