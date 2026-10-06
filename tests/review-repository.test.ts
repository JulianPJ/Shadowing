import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createD1ReviewRepository, ReviewConflict } from '../src/lib/review/repository';
import { createD1DictionaryRepository } from '../src/lib/dictionary/repository';
import { dictionarySource } from '../src/lib/dictionary/source';
import { handleReviewRequest } from '../src/lib/review/server';
import type { D1Database } from '../src/lib/d1';
import demo from '../src/data/demo.json';
import type { Lesson } from '../src/lib/types';
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'retention-test' },
  }),
);
let db: D1Database;
let review: ReturnType<typeof createD1ReviewRepository>;
let dictionary: ReturnType<typeof createD1DictionaryRepository>;
before(async () => {
  db = await mf.getD1Database('HIBIKI_DB');
  // Run historical migrations before 0007, including realistic existing users/words.
  for (const file of (await readdir('migrations'))
    .sort()
    .filter((f) => f.endsWith('.sql') && Number(f.slice(0, 4)) < 7))
    await db.batch(
      (await readFile(`migrations/${file}`, 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
  await db
    .prepare(
      `INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('old','Old','old@example.com',1,0,0)`,
    )
    .run();
  await db
    .prepare(
      `INSERT INTO user_dictionary_entries(user_id,id,term,normalized_term,translation,source_sentence,source_sentence_translation,lesson_id,segment_id,lesson_title,lesson_author,media_type,transcript_key,section_start,section_end,created_at,updated_at) VALUES ('old','existing','朝','朝','morning','朝です','Morning','demo','s1','Demo','Hibiki','demo','hash',0,2,'2026-01-01','2026-01-01')`,
    )
    .run();
  await db.batch(
    (await readFile('migrations/0007_retention.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  await db.batch(
    (await readFile('migrations/0008_tags_dictionary_pagination.sql', 'utf8'))
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
  review = createD1ReviewRepository(db);
  dictionary = createD1DictionaryRepository(db);
});
after(() => mf.dispose());
async function fixture() {
  const user = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
    )
    .bind(user, 'Learner', `${user}@example.com`)
    .run();
  const entry = await dictionary.save(user, {
    schemaVersion: 1,
    term: '朝',
    reading: 'あさ',
    translation: 'morning',
    sourceSentence: demo.segments[0].japanese,
    sourceSentenceTranslation: demo.segments[0].translation,
    source: await dictionarySource(demo as Lesson, demo.segments[0]),
  });
  return { user, entry };
}
test('migration backfills Inbox for existing words without automatic review', async () => {
  const s = await review.snapshot('old');
  assert.equal(s.decks[0].id, 'inbox');
  assert.deepEqual(s.memberships, [{ deckId: 'inbox', entryId: 'existing' }]);
  assert.equal(s.cards.length, 0);
});
test('new users get Inbox without entitlement or vocabulary rows', async () => {
  const user = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
    )
    .bind(user, 'Learner', `${user}@example.com`)
    .run();
  const s = await review.snapshot(user);
  assert.equal(s.decks.length, 1);
  assert.equal(s.cards.length, 0);
});
test('dictionary save keeps stable IDs and automatically adds Inbox membership', async () => {
  const { user, entry } = await fixture();
  let s = await review.snapshot(user);
  assert.equal(s.memberships[0].entryId, entry.id);
  assert.equal(s.cards.length, 0);
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    deckId: 'inbox',
    enrolledAt: entry.updatedAt,
  });
  const saved = await dictionary.save(user, { ...entry, translation: 'Morning' });
  assert.equal(saved.id, entry.id);
  s = await review.snapshot(user);
  assert.equal(s.cards[0].entryId, entry.id);
  assert.equal(s.cards.length, 1);
});
test('deck creation, multiple membership, removal and deletion preserve words and scheduling', async () => {
  const { user, entry } = await fixture();
  const deck = crypto.randomUUID();
  await review.apply(user, { action: 'deck', id: deck, name: 'Travel' });
  await review.apply(user, {
    action: 'membership',
    deckId: deck,
    entryIds: [entry.id],
    remove: false,
  });
  await review.apply(user, {
    action: 'enroll',
    deckId: deck,
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  let s = await review.snapshot(user);
  assert.equal(s.memberships.length, 2);
  assert.equal(s.cards.length, 1);
  await review.apply(user, {
    action: 'membership',
    deckId: deck,
    entryIds: [entry.id],
    remove: true,
  });
  s = await review.snapshot(user);
  assert.equal(s.memberships.length, 1);
  await review.apply(user, { action: 'delete-deck', deckId: deck });
  assert.equal((await dictionary.list(user)).length, 1);
  assert.equal((await review.snapshot(user)).cards.length, 1);
  await assert.rejects(review.apply(user, { action: 'delete-deck', deckId: 'inbox' }));
});
test('grades persist all scheduling fields and retries are idempotent; concurrent revisions conflict', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    deckId: 'inbox',
    enrolledAt: entry.updatedAt,
  });
  const op = {
    action: 'grade' as const,
    entryId: entry.id,
    revision: 0,
    grade: 'good' as const,
    reviewedAt: entry.updatedAt,
    operationId: crypto.randomUUID(),
  };
  await review.apply(user, op);
  await review.apply(user, op);
  const card = (await review.snapshot(user)).cards[0];
  assert.equal(card.intervalDays, 1);
  assert.equal(card.repetitions, 1);
  assert.equal(card.lastReviewedAt, op.reviewedAt);
  assert.equal(card.revision, 1);
  await assert.rejects(
    review.apply(user, { ...op, grade: 'easy', operationId: crypto.randomUUID() }),
    ReviewConflict,
  );
  const next = {
    ...op,
    revision: 1,
    grade: 'again' as const,
    reviewedAt: card.dueAt,
    operationId: crypto.randomUUID(),
  };
  await review.apply(user, next);
  assert.equal((await review.snapshot(user)).cards[0].lapses, 1);
});
test('suspend and re-enroll preserve history without automatic rescheduling existing cards', async () => {
  const { user, entry } = await fixture(),
    enroll = {
      action: 'enroll' as const,
      entryIds: [entry.id],
      deckId: 'inbox',
      enrolledAt: entry.updatedAt,
    };
  await review.apply(user, enroll);
  await review.apply(user, enroll);
  await review.apply(user, {
    action: 'suspend',
    entryId: entry.id,
    revision: 0,
    operationId: crypto.randomUUID(),
  });
  assert.equal((await review.snapshot(user)).cards[0].status, 'suspended');
  await review.apply(user, enroll);
  assert.equal((await review.snapshot(user)).cards[0].revision, 2);
});

test('simultaneous grades accept exactly one revision and preserve the winning schedule', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    deckId: 'inbox',
    enrolledAt: entry.updatedAt,
  });
  const op = {
    action: 'grade' as const,
    entryId: entry.id,
    revision: 0,
    reviewedAt: entry.updatedAt,
  };
  const results = await Promise.allSettled([
    review.apply(user, { ...op, grade: 'good', operationId: 'one' }),
    review.apply(user, { ...op, grade: 'easy', operationId: 'two' }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter((r) => r.status === 'rejected').length, 1);
  const card = (await review.snapshot(user)).cards[0];
  assert.equal(card.revision, 1);
  assert.equal(card.repetitions, 1);
  assert.ok([1, 4].includes(card.intervalDays));
});
test('owner isolation and foreign keys reject another account, missing word or missing deck', async () => {
  const a = await fixture(),
    b = await fixture();
  await review.snapshot(b.user);
  await assert.rejects(
    review.apply(b.user, {
      action: 'enroll',
      entryIds: [a.entry.id],
      deckId: 'inbox',
      enrolledAt: a.entry.updatedAt,
    }),
  );
  await assert.rejects(
    review.apply(a.user, {
      action: 'membership',
      deckId: 'missing',
      entryIds: [a.entry.id],
      remove: false,
    }),
  );
  await review.apply(b.user, { action: 'delete-deck', deckId: 'another' });
  assert.deepEqual((await review.snapshot(b.user)).cards, []);
  await assert.rejects(
    review.apply(b.user, {
      action: 'grade',
      entryId: a.entry.id,
      revision: 0,
      grade: 'good',
      reviewedAt: a.entry.updatedAt,
      operationId: crypto.randomUUID(),
    }),
    ReviewConflict,
  );
});
test('deleting vocabulary and accounts cascades; deleting a deck does not own vocabulary', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    deckId: 'inbox',
    enrolledAt: entry.updatedAt,
  });
  await dictionary.remove(user, entry.id);
  const s = await review.snapshot(user);
  assert.equal(s.cards.length, 0);
  assert.equal(s.memberships.length, 0);
  await db.prepare('DELETE FROM "user" WHERE id=?').bind(user).run();
  assert.equal(
    (
      await db
        .prepare('SELECT count(*) AS n FROM user_decks WHERE user_id=?')
        .bind(user)
        .first<{ n: number }>()
    )?.n,
    0,
  );
});
test('review API bounds and validates writes, rejects unverified mutations, and uses private cache headers', async () => {
  const { user } = await fixture();
  const req = (body: unknown) =>
    new Request('https://example.com/api/review', { method: 'POST', body: JSON.stringify(body) });
  assert.equal(
    (await handleReviewRequest(req({ action: 'deck', id: 'd', name: 'Deck' }), user, false, review))
      .status,
    403,
  );
  for (const body of [
    null,
    { action: 'delete-deck', deckId: 'inbox' },
    { action: 'enroll', entryIds: ['word'], deckId: 'inbox', enrolledAt: 'bad' },
    { action: 'grade', entryId: 'word', revision: -1, grade: 'good' },
  ])
    assert.equal((await handleReviewRequest(req(body), user, true, review)).status, 400);
  const response = await handleReviewRequest(
    new Request('https://example.com/api/review'),
    user,
    true,
    review,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(
    (
      await handleReviewRequest(
        req({ action: 'deck', id: 'd', name: 'x'.repeat(17000) }),
        user,
        true,
        review,
      )
    ).status,
    413,
  );
});
