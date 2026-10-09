import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import demo from '../src/data/demo.json' with { type: 'json' };
import { dictionarySource } from '../src/lib/dictionary/source';
import {
  DictionaryValidationError,
  normalizeDictionaryTerm,
  validateDictionarySaveInput,
} from '../src/lib/dictionary/validation';
import type { Lesson } from '../src/lib/types';
import { createD1DictionaryRepository } from '../src/lib/dictionary/repository';
import { localProgressDatabase } from './helpers/sqlite-d1';

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
  assert.equal(normalizeDictionaryTerm('  ＡＢＣ　日本語  '), 'abc 日本語');
});

test('dictionary save allows missing English while requiring exact Japanese context', () => {
  for (const sourceSentenceTranslation of [undefined, null, '', '   ']) {
    const entry = validateDictionarySaveInput({ ...baseEntry, sourceSentenceTranslation });
    assert.equal(entry.sourceSentenceTranslation, '');
    assert.equal(entry.sourceSentence, baseEntry.sourceSentence);
  }
  assert.throws(
    () => validateDictionarySaveInput({ ...baseEntry, sourceSentence: '' }),
    DictionaryValidationError,
  );
  assert.equal(
    validateDictionarySaveInput({ ...baseEntry, sourceSentence: `  ${baseEntry.sourceSentence}\n` })
      .sourceSentence,
    `  ${baseEntry.sourceSentence}\n`,
  );
  assert.throws(
    () => validateDictionarySaveInput({ ...baseEntry, sourceSentenceTranslation: 7 }),
    DictionaryValidationError,
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

test('dictionary migration and repository save, upsert, list and delete against SQLite', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON; CREATE TABLE "user" (id TEXT PRIMARY KEY);');
    db.prepare('INSERT INTO "user" (id) VALUES (?)').run('learner');
    db.exec(readFileSync('migrations/0004_personal_dictionary.sql', 'utf8'));
    db.exec(readFileSync('migrations/0007_retention.sql', 'utf8'));
    db.exec(readFileSync('migrations/0008_tags_dictionary_pagination.sql', 'utf8'));
    const repository = createD1DictionaryRepository(localProgressDatabase(db));
    const input = validateDictionarySaveInput(baseEntry);
    const saved = await repository.save('learner', input);
    assert.equal(saved.term, '勉強');
    assert.equal(saved.translation, 'study');
    assert.equal((await repository.list('learner')).length, 1);

    const untranslated = await repository.save('learner', {
      ...input,
      sourceSentenceTranslation: '',
    });
    assert.equal(untranslated.id, saved.id);
    assert.equal(untranslated.sourceSentenceTranslation, '');
    for (const search of ['勉', 'べん', 'STUD'])
      assert.equal((await repository.page('learner', { search })).entries[0]?.id, saved.id);
    assert.equal((await repository.page('learner', { search: '%' })).entries.length, 0);
    assert.equal((await repository.page('learner', { search: '_' })).entries.length, 0);
    assert.equal((await repository.page('learner', { term: '勉' })).entries.length, 0);

    const updated = await repository.save('learner', { ...input, translation: 'studying' });
    assert.equal(updated.id, saved.id);
    assert.equal(updated.createdAt, saved.createdAt);
    assert.equal(updated.translation, 'studying');
    assert.equal((await repository.list('learner')).length, 1);

    await repository.remove('learner', saved.id);
    assert.deepEqual(await repository.list('learner'), []);
  } finally {
    db.close();
  }
});
