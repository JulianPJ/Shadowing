import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import demo from '../src/data/demo.json';
import demoQuiz from '../src/data/demo-quiz.json';
import { createQuiz, mapEvidence, newAttempt, scoreQuiz, transcriptKey, updateAttempt, validateAttempt, validateQuestions, validateQuiz, validateQuizLesson } from '../src/lib/quiz';
import { completeLesson, lessonCompleted, loadQuiz, loadQuizAttempt, readStorage, saveQuiz, saveQuizAttempt, writeStorage } from '../src/lib/storage';
import { chatCompletionQuizProvider, generateLessonQuiz, QuizProviderError, readBoundedJson } from '../src/lib/providers/quiz';
import { POST } from '../src/app/api/quiz/route';
import type { QuizGenerationProvider } from '../src/lib/types';

const lesson = validateQuizLesson(demo);
const memory = new Map<string, string>();
beforeEach(() => {
  memory.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => memory.get(key) ?? null, setItem: (key: string, value: string) => memory.set(key, value) } });
});
test('strict schema accepts a grounded mix, assigns IDs and derives evidence timestamps', () => {
  const questions = validateQuestions(demoQuiz, lesson);
  assert.equal(questions.length, 5); assert.equal(new Set(questions.map(q => q.kind)).size, 5);
  assert.equal(questions[1].evidence.start, 8.132); assert.equal(questions[1].evidence.end, 12.15);
  assert.equal(questions[2].evidence.start, demo.segments[2].start);
  assert.equal(questions[2].evidence.end, demo.segments[4].end);
});
test('malformed, ambiguous and unsupported provider output is rejected', () => {
  for (const mutate of [
    (q: Record<string, unknown>) => { q.kind = 'made-up'; },
    (q: Record<string, unknown>) => { q.correctIndex = 4; },
    (q: Record<string, unknown>) => { q.correctIndex = '0'; },
    (q: Record<string, unknown>) => { q.correctIndex = 0.5; },
    (q: Record<string, unknown>) => { q.options = ['a', 'a', 'b', 'c']; },
    (q: Record<string, unknown>) => { q.options = ['A', 'a', 'b', 'c']; },
    (q: Record<string, unknown>) => { q.options = ['a', 'b']; },
    (q: Record<string, unknown>) => { q.explanation = ''; },
    (q: Record<string, unknown>) => { q.question = 'x'.repeat(601); },
    (q: Record<string, unknown>) => { q.evidence = { segmentIds: ['missing'], quote: 'invented' }; },
    (q: Record<string, unknown>) => { q.evidence = { segmentIds: ['segment-1'], quote: 'invented fact' }; },
    (q: Record<string, unknown>) => { q.surprise = true; },
    (q: Record<string, unknown>) => { q.id = 'injected'; },
  ]) {
    const raw = structuredClone(demoQuiz); mutate(raw.questions[0]);
    assert.throws(() => validateQuestions(raw, lesson));
  }
  for (const raw of [null, [], { questions: [] }, { questions: demoQuiz.questions.slice(0, 2) }, { questions: Array(8).fill(demoQuiz.questions[0]) }, { questions: [demoQuiz.questions[0], demoQuiz.questions[0], demoQuiz.questions[1]] }]) assert.throws(() => validateQuestions(raw, lesson));
});
test('evidence rejects disjoint, reversed, duplicate and fabricated timestamps; preserves fractional times', () => {
  const q = demoQuiz.questions[2].evidence;
  const mapped = mapEvidence(q, lesson.segments);
  assert.equal(mapped.start, 12.4); assert.equal(mapped.end, 27.57);
  assert.deepEqual(mapped.segmentIds, ['segment-3', 'segment-4', 'segment-5']);
  for (const ids of [['segment-3', 'segment-5'], ['segment-5', 'segment-4'], ['segment-3', 'segment-3']]) assert.throws(() => mapEvidence({ ...q, segmentIds: ids }, lesson.segments));
  assert.throws(() => mapEvidence({ ...q, start: 0 }, lesson.segments));
  assert.throws(() => mapEvidence({ ...q, end: 999 }, lesson.segments));
  assert.deepEqual(mapEvidence(mapped, lesson.segments), mapped);
});
test('transcript input rejects missing, overlapping, duplicate, invalid or oversized normalized sections', () => {
  for (const segments of [[], [{ ...lesson.segments[0], start: -1 }], [{ ...lesson.segments[0], end: Infinity }], [{ ...lesson.segments[0], japanese: '' }], [lesson.segments[0], lesson.segments[0]], Array.from({ length: 13 }, (_, i) => ({ id: `${i}`, start: i, end: i + 1, japanese: 'あ'.repeat(5000) }))]) assert.throws(() => validateQuizLesson({ id: 'test', segments }));
});
test('transcript fingerprints change for edited text, timing or segment identity but ignore media URLs', async () => {
  const key = await transcriptKey(lesson);
  assert.equal(key.length, 64); assert.equal(await transcriptKey({ ...lesson, segments: structuredClone(lesson.segments) }), key);
  for (const field of ['japanese', 'start', 'id'] as const) {
    const changed = structuredClone(lesson);
    if (field === 'start') changed.segments[0].start = 0.1;
    else changed.segments[0][field] += 'changed';
    assert.notEqual(await transcriptKey(changed), key);
  }
});
test('scoring is deterministic, including wrong answers and partial attempts; completion requires all answers', async () => {
  const quiz = await createQuiz(demoQuiz, lesson);
  const answers = quiz.questions.map(q => q.correctIndex);
  assert.equal(scoreQuiz(quiz, answers).score, 5);
  assert.equal(scoreQuiz(quiz, [1, 1]).score, 1);
  assert.equal(scoreQuiz(quiz, []).score, 0);
  for (const answers of [[-1], [4], [0.5], [NaN], [0, 0, 0, 0, 0, 0]]) assert.throws(() => scoreQuiz(quiz, answers));
  const attempt = newAttempt(quiz, lesson);
  assert.throws(() => updateAttempt(attempt, quiz, [0], true));
  const complete = updateAttempt(attempt, quiz, answers, true);
  assert.ok(complete.completedAt); assert.equal(complete.score, 5);
  assert.deepEqual(validateAttempt(complete, quiz, lesson), complete);
  // Future sync may reorder object keys without changing the learner event.
  const reordered = { ...complete, results: complete.results.map(r => ({ evidence: r.evidence, correct: r.correct, correctIndex: r.correctIndex, selectedIndex: r.selectedIndex, kind: r.kind, questionId: r.questionId })) };
  assert.deepEqual(validateAttempt(reordered, quiz, lesson), complete);
  assert.throws(() => validateAttempt({ ...complete, score: 0 }, quiz, lesson));
});
test('local quiz cache is reused only for matching lesson/transcript; damaged storage is recoverable', async () => {
  const quiz = await createQuiz(demoQuiz, lesson);
  assert.equal(saveQuiz(quiz), true); assert.deepEqual(await loadQuiz(lesson), quiz);
  const edited = structuredClone(lesson); edited.segments[0].end -= 0.1;
  assert.equal(await loadQuiz(edited), null);
  await assert.rejects(validateQuiz({ ...quiz, lessonId: 'other' }, lesson));
  await assert.rejects(validateQuiz({ ...quiz, generatedAt: 'invalid' }, lesson));
  memory.set('hibiki:v1:quiz:demo', '{broken'); assert.equal(await loadQuiz(lesson), null);
});
test('attempts resume, upsert by event ID, retain retakes and export portable lesson/video/results history', async () => {
  const videoLesson = { ...lesson, videoId: 'video-id' };
  const quiz = await createQuiz(demoQuiz, videoLesson);
  const attempt = updateAttempt(newAttempt(quiz, videoLesson), quiz, [0, 0]);
  assert.equal(saveQuizAttempt(attempt, quiz, videoLesson), true);
  assert.deepEqual(loadQuizAttempt(quiz, videoLesson), attempt);
  const finished = updateAttempt(attempt, quiz, [0, 0, 2, 3, 0], true);
  saveQuizAttempt(finished, quiz, videoLesson); saveQuizAttempt(finished, quiz, videoLesson);
  assert.equal(readStorage<unknown[]>('quiz-attempts', []).length, 1);
  const retake = newAttempt(quiz, videoLesson); saveQuizAttempt(retake, quiz, videoLesson);
  const history = readStorage<typeof finished[]>('quiz-attempts', []);
  assert.equal(history.length, 2); assert.equal(history[0].lessonId, 'demo'); assert.equal(history[0].videoId, 'video-id');
  assert.equal(history[0].quizAttempted, true); assert.equal(history[0].score, 4); assert.equal(history[0].totalQuestions, 5); assert.ok(history[0].completedAt);
  assert.equal(history[0].results[1].correct, false); assert.equal(history[0].results[1].selectedIndex, 0);
  writeStorage(`quiz-attempt:${quiz.id}`, { ...finished, score: 99 }); assert.equal(loadQuizAttempt(quiz, videoLesson), null);
});
test('lesson completion tracks the exact transcript and storage errors never throw into practice', () => {
  assert.equal(lessonCompleted(lesson), false); completeLesson(lesson); assert.equal(lessonCompleted(lesson), true);
  assert.equal(lessonCompleted({ ...lesson, segments: lesson.segments.slice(1) }), false);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } } });
  assert.equal(writeStorage('test', {}), false); assert.equal(lessonCompleted(lesson), false); assert.doesNotThrow(() => completeLesson(lesson));
});
test('replaceable provider generates arbitrary lesson quizzes without any live service; demo is independent', async () => {
  let calls = 0;
  const mock: QuizGenerationProvider = { name: 'mock', async generate() { calls++; return demoQuiz; } };
  const quiz = await generateLessonQuiz({ ...lesson, id: 'custom' }, new AbortController().signal, mock);
  assert.equal(calls, 1); assert.equal(quiz.lessonId, 'custom');
  await generateLessonQuiz(lesson, new AbortController().signal, mock); assert.equal(calls, 1);
  await assert.rejects(generateLessonQuiz({ ...lesson, id: 'custom' }, new AbortController().signal, { name: 'bad', async generate() { return { questions: [null] }; } }), error => error instanceof QuizProviderError && error.code === 'malformed');
  await assert.rejects(generateLessonQuiz({ ...lesson, id: 'custom' }, new AbortController().signal, { name: 'empty', async generate() { return { questions: [] }; } }), error => error instanceof QuizProviderError && error.code === 'insufficient-transcript');
});
test('chat-completions adapter uses server credentials and rejects truncated or malformed output (mocked fetch)', async () => {
  const oldFetch = globalThis.fetch;
  const oldEnv = { url: process.env.QUIZ_API_URL, key: process.env.QUIZ_API_KEY, model: process.env.QUIZ_MODEL };
  process.env.QUIZ_API_URL = 'https://quiz.example/v1/chat/completions'; process.env.QUIZ_API_KEY = 'test-secret'; process.env.QUIZ_MODEL = 'test-model';
  try {
    globalThis.fetch = async (_input, init) => {
      assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-secret');
      const body = JSON.parse(init?.body as string); assert.equal(body.model, 'test-model'); assert.ok(body.messages[1].content.includes(lesson.segments[0].japanese));
      assert.equal(body.messages[1].content.includes('mediaUrl'), false);
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(demoQuiz) } }] });
    };
    assert.deepEqual(await chatCompletionQuizProvider.generate(lesson, new AbortController().signal), demoQuiz);
    const generated = await POST(new Request('http://localhost/api/quiz', { method: 'POST', body: JSON.stringify({ ...lesson, id: 'custom-video' }) }));
    assert.equal(generated.status, 200);
    const generatedBody = await generated.json();
    await validateQuiz(generatedBody.quiz, { ...lesson, id: 'custom-video' });
    assert.equal(JSON.stringify(generatedBody).includes('test-secret'), false);
    globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ questions: [] }) } }] });
    const empty = await POST(new Request('http://localhost/api/quiz', { method: 'POST', body: JSON.stringify({ ...lesson, id: 'custom-video' }) }));
    assert.equal(empty.status, 422); assert.equal((await empty.json()).code, 'insufficient-transcript');
    for (const content of ['not json', '{}']) {
      globalThis.fetch = async () => Response.json({ choices: [{ finish_reason: 'length', message: { content } }] });
      await assert.rejects(chatCompletionQuizProvider.generate(lesson, new AbortController().signal), QuizProviderError);
    }
    globalThis.fetch = async () => new Response('provider private error', { status: 429 });
    await assert.rejects(chatCompletionQuizProvider.generate(lesson, new AbortController().signal), /unavailable/);
  } finally {
    globalThis.fetch = oldFetch;
    for (const [key, value] of Object.entries({ QUIZ_API_URL: oldEnv.url, QUIZ_API_KEY: oldEnv.key, QUIZ_MODEL: oldEnv.model })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
test('route accepts demo, rejects invalid/oversized input and cross-origin requests; failures are safe', async () => {
  const request = (body: unknown, origin = 'http://localhost') => new Request('http://localhost/api/quiz', { method: 'POST', headers: { origin }, body: JSON.stringify(body) });
  const response = await POST(request(lesson)); assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  await validateQuiz((await response.json()).quiz, lesson);
  assert.equal((await POST(request({ id: 'bad', segments: [] }))).status, 400);
  assert.equal((await POST(request(lesson, 'https://external.example'))).status, 403);
  assert.equal((await POST(request({ junk: 'x'.repeat(350001) }))).status, 400);
  await assert.rejects(readBoundedJson(new Response('x'.repeat(101)), 100));
  const apiUrl = process.env.QUIZ_API_URL; delete process.env.QUIZ_API_URL;
  try {
    const unavailable = await POST(request({ ...lesson, id: 'no-provider' }));
    assert.equal(unavailable.status, 503); assert.equal((await unavailable.json()).code, 'unconfigured');
  } finally { if (apiUrl !== undefined) process.env.QUIZ_API_URL = apiUrl; }
});
