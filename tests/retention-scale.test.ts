import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '../src/lib/d1';
import { createD1DictionaryRepository } from '../src/lib/dictionary/repository';
import { createD1ReviewRepository } from '../src/lib/review/repository';
import { createD1TagRepository, TagConflict } from '../src/lib/tags/repository';
import { handleDictionaryRequest } from '../src/lib/dictionary/server';
import { handleTagRequest } from '../src/lib/tags/server';
import { tagName, validateTagOperation } from '../src/lib/tags/validation';
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
  review: ReturnType<typeof createD1ReviewRepository>,
  tags: ReturnType<typeof createD1TagRepository>;
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
  review = createD1ReviewRepository(db);
  await review.apply('scale', { action: 'deck', id: 'old-deck', name: 'Existing' });
  await review.apply('scale', {
    action: 'enroll',
    entryIds: ['word-0001'],
    deckId: 'old-deck',
    enrolledAt: date,
  });
  const old = await review.snapshot('scale');
  await db.batch(
    (await readFile('migrations/0008_tags_dictionary_pagination.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  assert.deepEqual(await review.snapshot('scale'), old);
  dictionary = createD1DictionaryRepository(db);
  tags = createD1TagRepository(db);
});
after(() => mf.dispose());
const get = (query: string, user = 'scale') =>
  handleDictionaryRequest(
    new Request('https://example.com/api/dictionary' + query),
    user,
    true,
    dictionary,
  );
test('real D1 upgrades populated dictionary/deck/review and preserves foreign keys', async () => {
  assert.equal((await dictionary.list('scale')).length, 650);
  assert.equal((await review.snapshot('scale')).cards[0].entryId, 'word-0001');
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
  const fks = await db
    .prepare('PRAGMA foreign_key_list(user_dictionary_tags)')
    .all<{ from: string; to: string }>();
  assert.equal(fks.results.filter((f) => f.from === 'user_id').length, 2);
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
test('entire and filtered exports include old entries, context, decks and tags; TSV protects formulas', async () => {
  await tags.apply('scale', { action: 'create', id: 'export-tag', name: '旅行' });
  await tags.apply('scale', {
    action: 'membership',
    tagId: 'export-tag',
    entryIds: ['word-0001'],
    remove: false,
  });
  const entries = await dictionary.list('scale'),
    snapshot = await review.snapshot('scale'),
    rows = vocabularyRows(entries, snapshot);
  assert.equal(rows.length, 649);
  const old = rows.find((r) => r.term === '語1')!;
  assert.equal(old.tags, '旅行');
  assert.equal(old.decks, 'Existing');
  assert.equal(old.sourceSentence, '日本語');
  assert.ok(vocabularyCsv(rows).includes('"語1"'));
  assert.equal(
    (await dictionary.page('scale', { tagId: 'export-tag', deckId: 'old-deck', term: '語1' }))
      .entries.length,
    1,
  );
  assert.equal(
    (await dictionary.page('scale', { tagId: 'export-tag', deckId: 'inbox' })).entries.length,
    0,
  );
  const tsv = vocabularyTsv([{ ...old, translation: ' =SUM(1)\tbad\nline' }]);
  assert.ok(tsv.includes("' =SUM(1) bad line"));
  assert.equal(tsv.split('\n').length, 3);
});
test('tag normalization preserves Japanese display names and rejects bad input', () => {
  assert.deepEqual(tagName('  Ｔｒａｖｅｌ　 plans '), {
    name: 'Travel plans',
    normalizedName: 'travel plans',
  });
  assert.equal(tagName('旅行').name, '旅行');
  for (const name of ['', ' '.repeat(3), 'x'.repeat(65), 12, 'hi\u0000'])
    assert.throws(() => tagName(name));
  assert.throws(() =>
    validateTagOperation({
      action: 'membership',
      tagId: 't',
      entryIds: Array(51).fill('e'),
      remove: false,
    }),
  );
});
test('tags create, normalize uniqueness, rename, and isolate ownership', async () => {
  await tags.apply('scale', { action: 'create', id: 'travel', name: 'Travel' });
  await assert.rejects(
    tags.apply('scale', { action: 'create', id: 'duplicate', name: ' travel ' }),
    TagConflict,
  );
  await tags.apply('other', { action: 'create', id: 'travel', name: 'Travel' });
  await tags.apply('scale', { action: 'rename', id: 'travel', name: '旅行計画' });
  assert.equal((await tags.list('scale')).find((t) => t.id === 'travel')?.name, '旅行計画');
  assert.equal((await tags.list('other'))[0].name, 'Travel');
  await assert.rejects(
    tags.apply('other', {
      action: 'membership',
      tagId: 'travel',
      entryIds: ['word-0001'],
      remove: false,
    }),
  );
  await assert.rejects(
    tags.apply('scale', {
      action: 'membership',
      tagId: 'unknown',
      entryIds: ['word-0001'],
      remove: false,
    }),
  );
});
test('multiple tags, bulk membership, removal and deletion preserve vocabulary and review', async () => {
  await tags.apply('scale', {
    action: 'membership',
    tagId: 'travel',
    entryIds: ['word-0001', 'word-0002'],
    remove: false,
  });
  assert.equal((await dictionary.byIds('scale', ['word-0001']))[0].tags?.length, 2);
  assert.equal((await dictionary.page('scale', { tagId: 'travel' })).entries.length, 2);
  await tags.apply('scale', {
    action: 'membership',
    tagId: 'travel',
    entryIds: ['word-0002'],
    remove: true,
  });
  await tags.apply('scale', { action: 'delete', id: 'travel' });
  assert.equal((await dictionary.byIds('scale', ['word-0001']))[0].tags?.length, 1);
  assert.equal((await review.snapshot('scale')).cards.length, 1);
  await tags.apply('scale', {
    action: 'membership',
    tagId: 'export-tag',
    entryIds: ['word-0003'],
    remove: false,
  });
  await dictionary.remove('scale', 'word-0003');
  assert.equal(
    (
      await db
        .prepare("SELECT count(*) AS n FROM user_dictionary_tags WHERE entry_id='word-0003'")
        .first<{ n: number }>()
    )?.n,
    0,
  );
});
test('tag entry/account limits are atomic and duplicate membership is idempotent at the limit', async () => {
  for (let i = 0; i < 11; i++)
    await tags.apply('scale', { action: 'create', id: 'limit-' + i, name: 'Limit ' + i });
  for (let i = 0; i < 10; i++)
    await tags.apply('scale', {
      action: 'membership',
      tagId: 'limit-' + i,
      entryIds: ['word-0004'],
      remove: false,
    });
  await tags.apply('scale', {
    action: 'membership',
    tagId: 'limit-0',
    entryIds: ['word-0004'],
    remove: false,
  });
  await assert.rejects(
    tags.apply('scale', {
      action: 'membership',
      tagId: 'limit-10',
      entryIds: ['word-0005', 'word-0004'],
      remove: false,
    }),
    TagConflict,
  );
  assert.equal((await dictionary.byIds('scale', ['word-0005']))[0].tags?.length, 0);
  for (let i = 1; i < 100; i++)
    await tags.apply('other', { action: 'create', id: 't-' + i, name: 'Tag ' + i });
  await assert.rejects(
    tags.apply('other', { action: 'create', id: 'excess', name: 'Excess' }),
    TagConflict,
  );
  assert.equal((await tags.list('other')).length, 100);
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
test('tag API bounds, verification, ownership and private caching', async () => {
  const post = (value: unknown) =>
    new Request('https://example.com/api/tags', { method: 'POST', body: JSON.stringify(value) });
  assert.equal(
    (
      await handleTagRequest(
        post({ action: 'create', id: 'new', name: 'Food' }),
        'scale',
        false,
        tags,
      )
    ).status,
    403,
  );
  assert.equal((await handleTagRequest(post(null), 'scale', true, tags)).status, 400);
  assert.equal(
    (
      await handleTagRequest(
        post({ action: 'membership', tagId: 'export-tag', entryIds: ['word-0001'], remove: false }),
        'other',
        true,
        tags,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await handleTagRequest(
        post({ action: 'create', id: 'x', name: 'x'.repeat(13000) }),
        'scale',
        true,
        tags,
      )
    ).status,
    413,
  );
  assert.equal(
    (
      await handleTagRequest(new Request('https://example.com/api/tags'), 'scale', true, tags)
    ).headers.get('cache-control'),
    'no-store',
  );
});

test('maximum bulk tag batch adds and removes 50 memberships within D1 parameter limits', async () => {
  const entryIds = Array.from({ length: 50 }, (_, i) => 'word-' + String(i + 50).padStart(4, '0'));
  await tags.apply('scale', { action: 'membership', tagId: 'export-tag', entryIds, remove: false });
  for (const entry of await dictionary.byIds('scale', entryIds))
    assert.ok(entry.tags?.some((tag) => tag.id === 'export-tag'));
  await tags.apply('scale', { action: 'membership', tagId: 'export-tag', entryIds, remove: true });
  for (const entry of await dictionary.byIds('scale', entryIds))
    assert.equal(entry.tags?.length, 0);
});

test('composite foreign keys reject forged ownership even when bypassing repositories', async () => {
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO user_dictionary_tags(user_id,tag_id,entry_id) VALUES ('other','travel','word-0001')",
      )
      .run(),
  );
  await assert.rejects(
    db
      .prepare(
        "INSERT INTO user_dictionary_tags(user_id,tag_id,entry_id) VALUES ('scale','t-1','word-0001')",
      )
      .run(),
  );
  assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results, []);
});
