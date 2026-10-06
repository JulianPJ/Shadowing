import assert from 'node:assert/strict';
import { test } from 'node:test';
import demo from '../src/data/demo.json' with { type: 'json' };
import { dictionarySource } from '../src/lib/dictionary/source';
import {
  DictionaryValidationError,
  normalizeDictionaryTerm,
  validateDictionarySaveInput,
} from '../src/lib/dictionary/validation';
import type { Lesson } from '../src/lib/types';

const baseEntry = {
  schemaVersion: 1 as const,
  term: ' 勉強 ',
  reading: 'べんきょう',
  translation: 'study',
  sourceSentence: '日本語を勉強しています。',
  sourceSentenceTranslation: 'I am studying Japanese.',
  source: {
    lessonId: 'youtube:example',
    segmentId: 'segment-1',
    lessonTitle: 'Example lesson',
    lessonAuthor: 'Example author',
    mediaType: 'youtube' as const,
    mediaId: 'IJ6R4u05ppw',
    mediaUrl: 'https://www.youtube.com/watch?v=IJ6R4u05ppw',
    mediaContentKey: 'youtube:IJ6R4u05ppw',
    transcriptKey: 'a'.repeat(64),
    start: 12.5,
    end: 16.2,
  },
};

test('dictionary records keep bounded contextual replay metadata', () => {
  const entry = validateDictionarySaveInput(baseEntry);
  assert.equal(entry.term, '勉強');
  assert.equal(entry.source.mediaId, 'IJ6R4u05ppw');
  assert.equal(entry.source.start, 12.5);
  assert.equal(entry.source.end, 16.2);
  assert.equal(
    normalizeDictionaryTerm('  ＡＢＣ　日本語  '),
    'abc 日本語',
  );
});

test('dictionary validation refuses signed direct-media URLs and malformed timing', () => {
  assert.throws(
    () =>
      validateDictionarySaveInput({
        ...baseEntry,
        source: {
          ...baseEntry.source,
          mediaType: 'direct',
          mediaId: null,
          mediaContentKey: `direct:${'b'.repeat(64)}`,
          mediaUrl: 'https://media.example/video.mp4?token=SECRET',
        },
      }),
    DictionaryValidationError,
  );
  assert.throws(
    () =>
      validateDictionarySaveInput({
        ...baseEntry,
        source: { ...baseEntry.source, start: 20, end: 10 },
      }),
    DictionaryValidationError,
  );
});

test('dictionary source captures provider replay identity but never local or signed playback URLs', async () => {
  const authored = structuredClone(demo) as Lesson;
  const demoSource = await dictionarySource(authored, authored.segments[0]);
  assert.equal(demoSource.mediaType, 'demo');
  assert.equal(demoSource.mediaUrl, null);
  assert.equal(demoSource.transcriptKey.length, 64);

  const youtube = {
    ...structuredClone(demo),
    id: 'youtube:IJ6R4u05ppw',
    source: 'youtube',
    videoId: 'IJ6R4u05ppw',
    mediaUrl: undefined,
    mediaSource: {
      schemaVersion: 1,
      type: 'youtube',
      provider: 'youtube',
      videoId: 'IJ6R4u05ppw',
      canonicalUrl: 'https://www.youtube.com/watch?v=IJ6R4u05ppw',
      contentKey: 'youtube:IJ6R4u05ppw',
    },
  } as Lesson;
  const youtubeSource = await dictionarySource(youtube, youtube.segments[0]);
  assert.equal(youtubeSource.mediaUrl, 'https://www.youtube.com/watch?v=IJ6R4u05ppw');
  assert.equal(youtubeSource.mediaContentKey, 'youtube:IJ6R4u05ppw');

  const direct = {
    ...structuredClone(demo),
    id: 'direct-example',
    source: 'direct',
    videoId: undefined,
    mediaUrl: 'https://media.example/video.mp4?token=SECRET',
    mediaSource: {
      schemaVersion: 1,
      type: 'direct',
      canonicalUrl: 'https://media.example/video.mp4?token=SECRET',
      contentKey: `direct:${'c'.repeat(64)}`,
    },
  } as Lesson;
  const directSource = await dictionarySource(direct, direct.segments[0]);
  assert.equal(directSource.mediaUrl, null);
  assert.equal(directSource.mediaContentKey, `direct:${'c'.repeat(64)}`);
});
