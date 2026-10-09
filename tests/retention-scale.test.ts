import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '../src/lib/d1';
import { createD1DictionaryRepository } from '../src/lib/dictionary/repository';
import { createD1ReviewRepository } from '../src/lib/review/repository';
import { handleDictionaryRequest } from '../src/lib/dictionary/server';
import { dictionaryCursor } from '../src/lib/dictionary/query';
import { vocabularyRows, vocabularyCsv, vocabularyTsv } from '../src/lib/export/vocabulary';
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'phase-a2' },
  }),
);
let db: D1Database,
  dictionary: ReturnType<typeof createD1DictionaryRepository>,
  review: ReturnType<typeof createD1ReviewRepository>;
const date = '2026-10-01T00:00:00.000Z';
before(async () => {
  db = await mf.getD1Database('HIBIKI_DB');
  for (const file of (await readdir('migrations'))
    .sort()
    .filter((f) => f.endsWith('.sql') && Number(f.slice(0, 4)) < 8))
    await db.batch(
      (await readFile('migrations/' + file, 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  for (const user of ['scale', 'other'])
    await db
      .prepare(
        'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
      )
      .bind(user, user, user + '@example.com')
      .run();
  for (let start = 0; start < 650; start += 50)
    await db.batch(
      Array.from({ length: Math.min(50, 650 - start) }, (_, offset) => {
        const n = start + offset,
          id = 'word-' + String(n).padStart(4, '0');
        return db
          .prepare(
            `INSERT INTO user_dictionary_entries(user_id,id,term,normalized_term,translation,source_sentence,source_sentence_translation,lesson_id,segment_id,lesson_title,lesson_author,media_type,transcript_key,section_start,section_end,created_at,updated_at) VALUES ('scale',?,?,?,'meaning','日本語','Japanese',?,?,'Lesson','Hibiki','demo',?,0,2,?,?)`,
          )
          .bind(
            id,
            '語' + n,
            '語' + n,
            n < 10 ? 'old-lesson' : 'lesson',
            id,
            'a'.repeat(64),
            date,
            date,
          );
      }),
    );
  await db.batch(
    (await readFile('migrations/0011_review_events.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  review = createD1ReviewRepository(db);
  // A legacy deck membership from before decks were removed stays harmlessly in place.
  await db.batch([
    db
      .prepare(
        "INSERT INTO user_decks(user_id,id,name,created_at,updated_at) VALUES ('scale','old-deck','Existing',?,?)",
      )
      .bind(date, date),
    db.prepare(
      "INSERT INTO user_deck_entries(user_id,deck_id,entry_id) VALUES ('scale','old-deck','word-0001')",
    ),
  ]);
  await review.apply('scale', { action: 'enroll', entryIds: ['word-0001'], enrolledAt: date });
  const old = await review.snapshot('scale');
  await db.batch(
    (await readFile('migrations/0008_tags_dictionary_pagination.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  const upgraded = await review.snapshot('scale');
  assert.deepEqual(
    { ...upgraded, historySince: undefined, historyWindowStart: undefined },
    { ...old, historySince: undefined, historyWindowStart: undefined },
  );
  dictionary = createD1DictionaryRepository(db);
});
after(() => mf.dispose());
const get = (query: string, user = 'scale') =>
  handleDictionaryRequest(
    new Request('https://example.com/api/dictionary' + query),
    user,
    true,
    dictionary,
  );
test('real D1 upgrades populated dictionary and review data and preserves foreign keys', async () => {
  assert.equal((await dictionary.list('scale')).length, 650);
  assert.equal((await review.snapshot('scale')).cards[0].entryId, 'word-0001');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
test('cursor pages are stable with duplicate timestamps and reach beyond 500 without duplicates', async () => {
  const first = await dictionary.page('scale', { limit: 100 });
  assert.equal(first.entries[0].id, 'word-0649');
  assert.equal(first.entries.length, 100);
  assert.ok(first.nextCursor);
  const ids = first.entries.map((e) => e.id);
  let cursor: string | null = first.nextCursor;
  while (cursor) {
    const page = await dictionary.page('scale', { limit: 100, cursor });
    ids.push(...page.entries.map((e) => e.id));
    cursor = page.nextCursor;
  }
  assert.equal(ids.length, 650);
  assert.equal(new Set(ids).size, 650);
  assert.equal(ids.at(-1), 'word-0000');
  assert.equal(
    (await dictionary.page('scale', { limit: 1, cursor: dictionaryCursor(date, 'word-0100') }))
      .entries[0].id,
    'word-0099',
  );
});
test('cursor deletion does not shift or repeat subsequent records', async () => {
  const first = await dictionary.page('scale', { limit: 3 });
  await dictionary.remove('scale', 'word-0647');
  const second = await dictionary.page('scale', { limit: 3, cursor: first.nextCursor });
  assert.deepEqual(
    second.entries.map((e) => e.id),
    ['word-0646', 'word-0645', 'word-0644'],
  );
  assert.ok(!second.entries.some((e) => first.entries.some((p) => p.id === e.id)));
});
test('dictionary API rejects malformed cursors, filters, page sizes and excessive IDs', async () => {
  for (const query of [
    '?cursor=bad',
    '?cursor=' + encodeURIComponent(btoa('[1,"2026-99-01T00:00:00.000Z","word"]')),
    '?limit=101',
    '?limit=0',
    '?limit=1.5',
    '?limit=abc',
    '?deckId=x%27',
    '?transcriptKey=' + 'a'.repeat(64),
    '?userId=other',
    '?ids=' + Array.from({ length: 51 }, (_, i) => 'word-' + i).join(','),
    '?ids=word-0001&limit=1',
  ])
    assert.equal((await get(query)).status, 400, query);
  assert.equal((await get('?limit=100')).status, 200);
});
test('targeted old entries hydrate review and exact lesson revision without full traversal', async () => {
  const exact = await get('?ids=word-0001');
  assert.equal(exact.status, 200);
  assert.equal((await exact.json()).entries[0].id, 'word-0001');
  assert.equal((await get('?ids=word-0001', 'other')).status, 404);
  assert.equal((await get('?ids=missing')).status, 404);
  const page = await dictionary.page('scale', {
    lessonId: 'old-lesson',
    transcriptKey: 'a'.repeat(64),
  });
  assert.equal(page.entries.length, 10);
  assert.ok(page.entries.some((e) => e.id === 'word-0001'));
  assert.equal(
    (await dictionary.page('scale', { lessonId: 'old-lesson', transcriptKey: 'b'.repeat(64) }))
      .entries.length,
    0,
  );
});
test('entire exports include old entries and context; TSV protects formulas', async () => {
  const entries = await dictionary.list('scale'),
    rows = vocabularyRows(entries);
  assert.equal(rows.length, 649);
  const old = rows.find((r) => r.term === '語1')!;
  assert.equal(old.sourceSentence, '日本語');
  assert.deepEqual(Object.keys(old).includes('decks'), false);
  assert.ok(vocabularyCsv(rows).includes('"語1"'));
  assert.equal((await dictionary.page('scale', { term: '語1' })).entries.length, 1);
  const tsv = vocabularyTsv([{ ...old, translation: ' =SUM(1)\tbad\nline' }]);
  assert.ok(tsv.includes("' =SUM(1) bad line"));
  assert.equal(tsv.split('\n').length, 3);
});

test('deleting a word removes its card and any legacy deck membership', async () => {
  await dictionary.remove('scale', 'word-0001');
  assert.equal((await review.snapshot('scale')).cards.length, 0);
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM user_deck_entries WHERE entry_id='word-0001'")
        .first<{ n: number }>()
    )?.n,
    0,
  );
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
