import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMemoryStorage } from './helpers/memory-storage';
import {
  japaneseTrack,
  lessonFromPageTrack,
  validatePendingImport,
} from '../src/lib/extension/page-import';
import { migrateLesson, pageMedia, sourceLabel } from '../src/lib/media';
import { saveLesson } from '../src/lib/storage/lessons';
import { deviceSnapshot } from '../src/lib/sync/snapshot';
import { validateSync } from '../src/lib/sync/validation';
import { dictionarySource } from '../src/lib/dictionary/source';
import { validateDictionarySaveInput } from '../src/lib/dictionary/validation';
import { transcriptLabel } from '../src/lib/caption-labels';

const cues = [
  { start: 0.5, end: 2.5, text: '今日はいい天気ですね。' },
  { start: 3, end: 5, text: '散歩に行きましょう。' },
];
const pending = (tracks: unknown[] = [{ label: '日本語', language: 'ja', cues }]) => ({
  tabId: 12,
  pageUrl: 'https://videos.example/watch/123?list=4#t=10',
  title: '  A walk in Kyoto  ',
  duration: 95.2,
  tracks,
});

test('the video Hibiki Bridge hands over is validated before it reaches a lesson', () => {
  const valid = validatePendingImport(pending());
  assert.equal(valid.title, 'A walk in Kyoto');
  assert.equal(valid.tracks[0].cues.length, 2);
  for (const bad of [
    null,
    { ...pending(), tabId: 'twelve' },
    { ...pending(), pageUrl: 'javascript:alert(1)' },
    { ...pending(), pageUrl: 'https://user:secret@videos.example/' },
    { ...pending(), duration: Number.NaN },
    { ...pending(), duration: 0 },
    { ...pending(), tracks: 'none' },
  ])
    assert.throws(() => validatePendingImport(bad));
  assert.throws(() => validatePendingImport({ ...pending(), duration: 5 * 3600 }), /four hours/);
  // Unusable tracks are dropped rather than failing the whole hand-off.
  const mixed = validatePendingImport(
    pending([{ label: 'broken', language: 'ja', cues: [{ start: 'x' }] }, { cues }, 'junk']),
  );
  assert.equal(mixed.tracks.length, 1);
});

test('the Japanese subtitle track is chosen by language, label, or content', () => {
  const english = { label: 'English', language: 'en', cues: [{ start: 0, end: 1, text: 'Hi' }] };
  const japanese = { label: 'Japanese', language: 'ja-JP', cues };
  assert.equal(japaneseTrack([english, japanese]), japanese);
  const labelled = { label: '日本語字幕', language: '', cues };
  assert.equal(japaneseTrack([english, labelled]), labelled);
  const unlabelled = { label: '', language: '', cues };
  assert.equal(japaneseTrack([english, unlabelled]), unlabelled);
  assert.equal(japaneseTrack([english]), null);
});

test('page lessons keep the page out of shared content and sync as media that needs its page', async () => {
  installMemoryStorage();
  const handoff = validatePendingImport(pending());
  const lesson = await lessonFromPageTrack(handoff, handoff.tracks[0]);
  const media = await pageMedia(handoff.pageUrl);
  assert.equal(media.canonicalUrl, 'https://videos.example/watch/123?list=4');
  assert.match(media.pageKey, /^page:[a-f0-9]{64}$/);
  assert.ok(!('contentKey' in media));
  assert.equal(lesson.id, `page-${media.pageKey.slice(5)}`);
  assert.equal(lesson.source, 'page');
  assert.equal(lesson.title, 'A walk in Kyoto');
  assert.equal(sourceLabel(lesson), 'Web page');
  assert.equal(transcriptLabel(lesson), 'Subtitles from the page');
  assert.deepEqual(migrateLesson(lesson).mediaSource, media);
  assert.throws(
    () => migrateLesson({ ...lesson, mediaSource: { ...media, pageKey: 'page:bad' } }),
    /web-page identity/,
  );
  assert.throws(
    () =>
      migrateLesson({
        ...lesson,
        mediaSource: { ...media, contentKey: 'direct:x' } as typeof media,
      }),
    /web-page identity/,
  );

  saveLesson(lesson, 1);
  const snapshot = validateSync(await deviceSnapshot());
  const reference = snapshot.lessons.find((item) => item.lesson.lessonId === lesson.id);
  assert.ok(reference);
  assert.equal(reference.contentKey, null);
  assert.equal(reference.mediaAvailable, false);
  assert.equal(reference.lesson.source, 'page');

  // A saved word replays through its Hibiki lesson, like a local file.
  const source = await dictionarySource(lesson, lesson.segments[0]);
  assert.equal(source.mediaType, 'local');
  assert.equal(source.mediaUrl, null);
  assert.doesNotThrow(() =>
    validateDictionarySaveInput({
      schemaVersion: 1,
      term: '天気',
      reading: 'てんき',
      translation: 'weather',
      sourceSentence: lesson.segments[0].japanese,
      sourceSentenceTranslation: null,
      source,
    }),
  );
});
