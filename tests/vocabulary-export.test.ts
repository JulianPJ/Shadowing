import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vocabularyRows, vocabularyCsv } from '../src/lib/export/vocabulary';
import { dictionarySource } from '../src/lib/dictionary/source';
import { contextHref, externalReplay } from '../src/lib/dictionary/replay';
import { applyLocalReview, emptyReview } from '../src/lib/review/local';
import type { DictionaryEntry } from '../src/lib/dictionary/types';
import demo from '../src/data/demo.json';
import type { Lesson } from '../src/lib/types';
test('export preserves context, decks, Japanese and CSV escaping while neutralizing formulas', async () => {
  const entry: DictionaryEntry = {
    schemaVersion: 1,
    id: 'e',
    normalizedTerm: '朝',
    term: '朝',
    reading: 'あさ',
    translation: '=HYPERLINK("evil")',
    sourceSentence: '朝,"静か"\nです',
    sourceSentenceTranslation: 'Morning\tquiet',
    source: await dictionarySource(demo as Lesson, demo.segments[0]),
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
  const rows = vocabularyRows([entry], {
    decks: [{ id: 'inbox', name: 'Inbox', createdAt: '', updatedAt: '' }],
    memberships: [{ deckId: 'inbox', entryId: 'e' }],
    cards: [],
  });
  const csv = vocabularyCsv(rows);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"あさ"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""evil"")"'));
  assert.ok(csv.includes('"朝,""静か""\nです"'));
  assert.equal(rows[0].decks, 'Inbox');
  assert.equal(rows[0].sourceUrl, '');
  assert.equal(rows[0].start, demo.segments[0].start);
  assert.equal(
    contextHref(entry),
    `/practice/demo?section=${demo.segments[0].id}&transcript=${entry.source.transcriptKey}`,
  );
  for (const url of [
    'https://example.com/a.mp4?token=SECRET',
    'https://user:pass@example.com/a.mp4',
    'javascript:alert(1)',
  ])
    assert.equal(
      externalReplay({ ...entry, source: { ...entry.source, mediaType: 'direct', mediaUrl: url } }),
      null,
    );
  assert.equal(
    externalReplay({
      ...entry,
      source: {
        ...entry.source,
        mediaType: 'vimeo',
        mediaId: '123',
        mediaUrl: 'https://player.vimeo.com/video/123?h=SECRET',
      },
    }),
    'https://vimeo.com/123#t=0s',
  );
});
test('optimistic local enrollment and grades use references and preserve repeat enrollments', () => {
  const now = '2026-10-06T00:00:00.000Z';
  const op = { action: 'enroll' as const, entryIds: ['e'], deckId: 'inbox', enrolledAt: now };
  let data = applyLocalReview(emptyReview(), op);
  data = applyLocalReview(data, op);
  assert.equal(data.cards.length, 1);
  data = applyLocalReview(data, {
    action: 'grade',
    entryId: 'e',
    revision: 0,
    grade: 'easy',
    reviewedAt: now,
    operationId: 'op',
  });
  assert.equal(data.cards[0].intervalDays, 4);
  assert.ok(!('term' in data.cards[0]));
  const retried = applyLocalReview(data, {
    action: 'grade',
    entryId: 'e',
    revision: 0,
    grade: 'easy',
    reviewedAt: now,
    operationId: 'op',
  });
  assert.deepEqual(retried, data);
});
