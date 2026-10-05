import assert from 'node:assert/strict';
import { test } from 'node:test';
import demo from '../src/data/demo.json';
import type { Lesson, Segment } from '../src/lib/types';
import {\n  createSectionLookup,\n  sectionPlaybackEnd,\n  shadowingBoundaryLead,\n} from '../src/lib/section-lookup';
import { BodyLimitError, readBoundedText } from '../src/lib/http-body';
import { saveLesson, loadLesson, recentLessons } from '../src/lib/storage';
import { installMemoryStorage } from './helpers/memory-storage';
import { handleTranslationRequest } from '../src/lib/translation-api';
import { createPrepareHandler } from '../src/lib/prepare';

test('indexed playback matches the original predicate at boundaries, gaps and legacy ordering', () => {
  const examples: Segment[][] = [
    demo.segments,
    [
      { id: 'a', start: 2, end: 4, japanese: 'あ' },
      { id: 'b', start: 8, end: 10, japanese: 'い' },
      { id: 'c', start: 8, end: 11, japanese: 'う' },
    ],
    [
      { id: 'a', start: 8, end: 10, japanese: 'あ' },
      { id: 'b', start: 2, end: 4, japanese: 'い' },
    ],
    [],
  ];
  for (const segments of examples) {
    const duration = segments.at(-1)?.end ?? 0;
    const lookup = createSectionLookup(segments, duration);
    const times = [NaN, Infinity, -Infinity, -1, 0, duration + 1];
    for (const section of segments) {
      for (const offset of [-0.021, -0.02, -0.019, -0.001, 0, 0.001, 0.02, 0.025, 1, 1.25]) {
        times.push(section.start + offset, section.end + offset);
      }
    }
    for (let time = 0; time < duration + 2; time += 0.007) times.push(time);
    for (const time of times) {
      const original = segments.findIndex(
        (s, n) => time >= s.start - 0.02 && time < (segments[n + 1]?.start ?? duration + 1),
      );
      assert.equal(lookup(time), original, `Lookup at ${time}`);
    }
  }
});

test('shadowing boundaries stop before overlapping next sections and compensate YouTube pause latency', () => {
  const overlapping: Segment[] = [
    { id: 'a', start: 0, end: 2.2, japanese: '最初' },
    { id: 'b', start: 2, end: 4, japanese: '次' },
  ];
  const gapped: Segment[] = [
    { id: 'a', start: 0, end: 1.8, japanese: '最初' },
    { id: 'b', start: 2, end: 4, japanese: '次' },
  ];
  assert.equal(sectionPlaybackEnd(overlapping, 0), 2);
  assert.equal(sectionPlaybackEnd(gapped, 0), 1.8);
  assert.equal(sectionPlaybackEnd(overlapping, 1), 4);
  assert.equal(shadowingBoundaryLead('demo', 1), 0.025);
  assert.equal(shadowingBoundaryLead('youtube', 0.5), 0.03);
  assert.equal(shadowingBoundaryLead('youtube', 1), 0.055);
  assert.equal(shadowingBoundaryLead('youtube', 1.25), 0.06875);
});

test('shared reader preserves split Japanese UTF-8 and cancels oversized bodies before consuming more', async () => {
  const bytes = new TextEncoder().encode('日本語の練習。');
  const split = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    },
  });
  assert.equal(await readBoundedText(new Response(split), bytes.length), '日本語の練習。');
  let cancelled = false;
  const oversized = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(readBoundedText(new Response(oversized), bytes.length - 1), BodyLimitError);
  assert.equal(cancelled, true);
  assert.equal(oversized.locked, false);
  assert.equal(await readBoundedText(new Response(null), 0), '');
});

test('stream byte limits retain valid Japanese character limits and existing oversized-input responses', async () => {
  let translations = 0;
  const provider = {
    name: 'refactor-limit-test',
    async translate() {
      translations++;
      return 'Translation';
    },
  };
  const request = (body: string) =>
    new Request('https://example.com/api/translate', { method: 'POST', body });
  const valid = await handleTranslationRequest(
    request(
      JSON.stringify({
        japanese: 'あ'.repeat(1200),
        previousJapanese: 'い'.repeat(1200),
        nextJapanese: 'う'.repeat(1200),
      }),
    ),
    provider,
  );
  assert.equal(valid.status, 200);
  assert.equal(translations, 1);
  for (const body of ['x'.repeat(5001), 'あ'.repeat(7000)]) {
    const response = await handleTranslationRequest(request(body), provider);
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, 'This section is too long to translate.');
  }
  assert.equal(translations, 1);
  const prepare = createPrepareHandler({
    captions: {
      name: 'unused',
      async transcribe() {
        throw new Error('Must not acquire captions');
      },
    },
  });
  for (const body of ['x'.repeat(3001), 'あ'.repeat(5000)]) {
    const response = await prepare(
      new Request('https://example.com/api/prepare', { method: 'POST', body }),
    );
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'invalid-url', error: 'The URL is too long.' });
  }
});

test('position saves avoid unchanged transcript writes and still persist edits and legacy history', () => {
  const memory = new Map<string, string>();
  const storage = installMemoryStorage(memory);
  const writes: string[] = [];
  const original = storage.setItem;
  storage.setItem = (key, value) => {
    writes.push(key);
    original(key, value);
  };
  const lesson = structuredClone(demo) as Lesson;
  saveLesson(lesson, 0);
  const initial = loadLesson(lesson.id);
  saveLesson(lesson, 1);
  saveLesson(lesson, 2);
  assert.equal(writes.filter((key) => key === `hibiki:v1:lesson:${lesson.id}`).length, 1);
  assert.equal(memory.get(`hibiki:v1:position:${lesson.id}`), '2');
  assert.deepEqual(loadLesson(lesson.id), initial);
  assert.equal(recentLessons()[0].index, 2);
  assert.ok(Array.isArray(JSON.parse(memory.get('hibiki:v1:history')!)));
  lesson.segments[0].japanese += '変更';
  saveLesson(lesson, 2);
  assert.equal(writes.filter((key) => key === `hibiki:v1:lesson:${lesson.id}`).length, 2);
  assert.equal(loadLesson(lesson.id)?.segments[0].japanese, lesson.segments[0].japanese);
});
