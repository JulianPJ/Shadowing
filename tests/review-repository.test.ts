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
import { previewReview } from '../src/lib/review-scheduler';
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
  await db.batch(
    (await readFile('migrations/0011_review_events.sql', 'utf8'))
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
test('existing saved words keep no automatic review card after migration', async () => {
  const s = await review.snapshot('old');
  assert.deepEqual(Object.keys(s).sort(), [
    'cards',
    'history',
    'historySince',
    'historyWindowStart',
  ]);
  assert.equal(s.cards.length, 0);
  assert.deepEqual(s.history, []);
});
test('new users start with an empty schedule and no vocabulary rows', async () => {
  const user = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
    )
    .bind(user, 'Learner', `${user}@example.com`)
    .run();
  const s = await review.snapshot(user);
  assert.equal(s.cards.length, 0);
});
test('dictionary save keeps stable IDs and enrolling creates exactly one card', async () => {
  const { user, entry } = await fixture();
  let s = await review.snapshot(user);
  assert.equal(s.cards.length, 0);
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  const saved = await dictionary.save(user, { ...entry, translation: 'Morning' });
  assert.equal(saved.id, entry.id);
  s = await review.snapshot(user);
  assert.equal(s.cards[0].entryId, entry.id);
  assert.equal(s.cards.length, 1);
});
test('grades persist all scheduling fields and retries are idempotent; concurrent revisions conflict', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
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
  let card = (await review.snapshot(user)).cards[0];
  assert.equal(card.intervalDays, 0);
  assert.equal(card.status, 'learning');
  assert.equal(card.repetitions, 1);
  assert.equal(Date.parse(card.dueAt) - Date.parse(op.reviewedAt), 600_000);
  assert.equal(card.lastReviewedAt, op.reviewedAt);
  assert.equal(card.revision, 1);
  assert.deepEqual((await review.snapshot(user)).history, [
    {
      operationId: op.operationId,
      entryId: entry.id,
      grade: 'good',
      status: 'new',
      reviewedAt: op.reviewedAt,
    },
  ]);
  await assert.rejects(
    review.apply(user, { ...op, grade: 'easy', operationId: crypto.randomUUID() }),
    ReviewConflict,
  );
  const graduation = {
    ...op,
    revision: 1,
    reviewedAt: card.dueAt,
    operationId: crypto.randomUUID(),
  };
  await review.apply(user, graduation);
  card = (await review.snapshot(user)).cards[0];
  assert.equal(card.status, 'review');
  assert.equal(card.intervalDays, 1);
  const next = {
    ...op,
    revision: 2,
    grade: 'again' as const,
    reviewedAt: card.dueAt,
    operationId: crypto.randomUUID(),
  };
  await review.apply(user, next);
  assert.equal((await review.snapshot(user)).cards[0].lapses, 1);
  assert.deepEqual(
    (await review.snapshot(user)).history?.map((event) => event.status),
    ['new', 'learning', 'review'],
  );
});

test('learning and relearning steps round-trip existing D1 columns and match previews', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  let card = (await review.snapshot(user)).cards[0];
  for (const grade of ['again', 'hard', 'good', 'good', 'again', 'hard', 'good', 'good'] as const) {
    const preview = previewReview(card, grade, card.dueAt);
    await review.apply(user, {
      action: 'grade',
      entryId: entry.id,
      revision: card.revision,
      grade,
      reviewedAt: card.dueAt,
      operationId: crypto.randomUUID(),
    });
    card = (await review.snapshot(user)).cards[0];
    for (const field of [
      'status',
      'dueAt',
      'intervalDays',
      'repetitions',
      'lapses',
      'ease',
      'revision',
      'algorithm',
      'schemaVersion',
      'createdAt',
    ] as const)
      assert.equal(card[field], preview.state[field], field);
  }
  assert.equal(card.status, 'review');
  assert.equal(card.lapses, 1);
  assert.equal(card.intervalDays, 1);
});

test('undo restores the last rating with a new revision and lost-response retries are idempotent', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  const previous = (await review.snapshot(user)).cards[0];
  const targetOperationId = crypto.randomUUID();
  await review.apply(user, {
    action: 'grade',
    entryId: entry.id,
    revision: 0,
    grade: 'good',
    reviewedAt: entry.updatedAt,
    operationId: targetOperationId,
  });
  const undo = {
    action: 'undo' as const,
    entryId: entry.id,
    revision: 1,
    targetOperationId,
    previous,
    undoneAt: new Date(Date.parse(entry.updatedAt) + 1000).toISOString(),
    operationId: crypto.randomUUID(),
  };
  await review.apply(user, undo);
  await review.apply(user, undo);
  const restored = (await review.snapshot(user)).cards[0];
  for (const field of [
    'status',
    'dueAt',
    'lastReviewedAt',
    'intervalDays',
    'ease',
    'repetitions',
    'lapses',
    'createdAt',
  ] as const)
    assert.equal(restored[field], previous[field], field);
  assert.equal(restored.revision, 2);
  assert.equal(restored.updatedAt, undo.undoneAt);
  assert.deepEqual((await review.snapshot(user)).history, []);
  await assert.rejects(
    review.apply(user, { ...undo, operationId: crypto.randomUUID() }),
    ReviewConflict,
  );
});

test('undo checks account ownership, target operation, prior identity and monotonic time', async () => {
  const { user, entry } = await fixture();
  const other = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  const previous = (await review.snapshot(user)).cards[0];
  const targetOperationId = crypto.randomUUID();
  await review.apply(user, {
    action: 'grade',
    entryId: entry.id,
    revision: 0,
    grade: 'easy',
    reviewedAt: entry.updatedAt,
    operationId: targetOperationId,
  });
  const undo = {
    action: 'undo' as const,
    entryId: entry.id,
    revision: 1,
    targetOperationId,
    previous,
    undoneAt: new Date(Date.parse(entry.updatedAt) + 1000).toISOString(),
    operationId: crypto.randomUUID(),
  };
  await assert.rejects(review.apply(other.user, undo), ReviewConflict);
  for (const invalid of [
    { ...undo, targetOperationId: crypto.randomUUID() },
    { ...undo, previous: { ...previous, entryId: other.entry.id } },
    { ...undo, previous: { ...previous, revision: 1 } },
    { ...undo, previous: { ...previous, createdAt: '2020-01-01T00:00:00.000Z' } },
    { ...undo, undoneAt: new Date(Date.parse(entry.updatedAt) - 1000).toISOString() },
  ])
    await assert.rejects(review.apply(user, invalid), ReviewConflict);
  const unchanged = (await review.snapshot(user)).cards[0];
  assert.equal(unchanged.revision, 1);
  assert.equal(unchanged.intervalDays, 4);
  assert.equal((await review.snapshot(user)).history?.length, 1);
  assert.deepEqual((await review.snapshot(other.user)).history, []);
});

test('simultaneous undo and rating accept one revision and never overwrite the winning state', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  const previous = (await review.snapshot(user)).cards[0];
  const targetOperationId = crypto.randomUUID();
  await review.apply(user, {
    action: 'grade',
    entryId: entry.id,
    revision: 0,
    grade: 'good',
    reviewedAt: entry.updatedAt,
    operationId: targetOperationId,
  });
  const changedAt = new Date(Date.parse(entry.updatedAt) + 1000).toISOString();
  const results = await Promise.allSettled([
    review.apply(user, {
      action: 'undo',
      entryId: entry.id,
      revision: 1,
      targetOperationId,
      previous,
      undoneAt: changedAt,
      operationId: crypto.randomUUID(),
    }),
    review.apply(user, {
      action: 'grade',
      entryId: entry.id,
      revision: 1,
      grade: 'easy',
      reviewedAt: changedAt,
      operationId: crypto.randomUUID(),
    }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  const card = (await review.snapshot(user)).cards[0];
  assert.equal(card.revision, 2);
  assert.equal(card.updatedAt, changedAt);
  assert.equal(card.status, results[0].status === 'fulfilled' ? 'new' : 'review');
  assert.equal(card.intervalDays, results[0].status === 'fulfilled' ? 0 : 4);
  assert.equal(
    (await review.snapshot(user)).history?.length,
    results[0].status === 'fulfilled' ? 0 : 2,
  );
});
test('suspend and re-enroll preserve history without automatic rescheduling existing cards', async () => {
  const { user, entry } = await fixture(),
    enroll = {
      action: 'enroll' as const,
      entryIds: [entry.id],
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
  assert.ok([0, 4].includes(card.intervalDays));
  const history = (await review.snapshot(user)).history;
  assert.equal(history?.length, 1);
  assert.equal(history?.[0].grade, card.intervalDays === 4 ? 'easy' : 'good');
});

test('authoritative history is account-owned, capped at 10000 and bounded by its server window', async () => {
  const { user, entry } = await fixture();
  const other = await fixture();
  const reviewedAt = new Date(Date.now() - 60_000).toISOString();
  await db
    .prepare(
      `WITH RECURSIVE sequence(n) AS (SELECT 0 UNION ALL SELECT n+1 FROM sequence WHERE n<10001) INSERT INTO user_review_events(user_id,operation_id,entry_id,grade,status,reviewed_at) SELECT ?,'bulk-' || printf('%05d',n),?,'good','new',? FROM sequence`,
    )
    .bind(user, entry.id, reviewedAt)
    .run();
  await db
    .prepare(
      `INSERT INTO user_review_events(user_id,operation_id,entry_id,grade,status,reviewed_at) VALUES (?,'ancient',?,'good','new',?)`,
    )
    .bind(user, entry.id, new Date(Date.now() - 8 * 86_400_000).toISOString())
    .run();
  await db
    .prepare(
      `INSERT INTO user_review_events(user_id,operation_id,entry_id,grade,status,reviewed_at) VALUES (?,'bulk-10001',?,'easy','review',?)`,
    )
    .bind(other.user, other.entry.id, reviewedAt)
    .run();
  const before = Date.now();
  const snapshot = await review.snapshot(user);
  assert.equal(snapshot.history?.length, 10000);
  assert.equal(snapshot.history?.[0].operationId, 'bulk-00002');
  assert.equal(snapshot.history?.at(-1)?.operationId, 'bulk-10001');
  assert.ok(Date.parse(snapshot.historySince!) >= before - 7 * 86_400_000);
  assert.ok(Date.parse(snapshot.historySince!) <= Date.now());
  assert.ok(Date.parse(snapshot.historyWindowStart!) >= before - 7 * 86_400_000);
  assert.ok(Date.parse(snapshot.historyWindowStart!) <= Date.now() - 7 * 86_400_000);
  const metadata = await db
    .prepare('SELECT first_recorded_at AS firstRecordedAt FROM review_event_metadata WHERE id=1')
    .first<{ firstRecordedAt: string }>();
  assert.equal(snapshot.historySince, metadata?.firstRecordedAt);
  assert.ok(snapshot.history?.every((event) => event.grade === 'good'));
  assert.equal((await review.snapshot(other.user)).history?.[0].grade, 'easy');
});

test('schedule and rating history roll back together when recording an event fails', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  await db
    .prepare(
      `CREATE TRIGGER reject_review_event BEFORE INSERT ON user_review_events BEGIN SELECT RAISE(ABORT,'test event failure'); END`,
    )
    .run();
  try {
    await assert.rejects(
      review.apply(user, {
        action: 'grade',
        entryId: entry.id,
        revision: 0,
        grade: 'good',
        reviewedAt: entry.updatedAt,
        operationId: crypto.randomUUID(),
      }),
    );
    const snapshot = await review.snapshot(user);
    assert.equal(snapshot.cards[0].revision, 0);
    assert.equal(snapshot.cards[0].status, 'new');
    assert.deepEqual(snapshot.history, []);
  } finally {
    await db.prepare('DROP TRIGGER reject_review_event').run();
  }
});

test('an accepted operation ID cannot be reused for another rating revision', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  const operation = {
    action: 'grade' as const,
    entryId: entry.id,
    revision: 0,
    grade: 'good' as const,
    reviewedAt: entry.updatedAt,
    operationId: crypto.randomUUID(),
  };
  await Promise.all([review.apply(user, operation), review.apply(user, operation)]);
  await assert.rejects(
    review.apply(user, { ...operation, revision: 1, grade: 'easy' }),
    ReviewConflict,
  );
  const snapshot = await review.snapshot(user);
  assert.equal(snapshot.cards[0].revision, 1);
  assert.equal(snapshot.cards[0].status, 'learning');
  assert.equal(snapshot.history?.length, 1);
});

test('accepted ratings survive vocabulary deletion and account deletion cascades their history', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  await review.apply(user, {
    action: 'grade',
    entryId: entry.id,
    revision: 0,
    grade: 'easy',
    reviewedAt: entry.updatedAt,
    operationId: crypto.randomUUID(),
  });
  await dictionary.remove(user, entry.id);
  const snapshot = await review.snapshot(user);
  assert.equal(snapshot.cards.length, 0);
  assert.equal(snapshot.history?.length, 1);
  assert.equal(snapshot.history?.[0].entryId, entry.id);
  await db.prepare('DELETE FROM "user" WHERE id=?').bind(user).run();
  assert.equal(
    (
      await db
        .prepare('SELECT count(*) AS n FROM user_review_events WHERE user_id=?')
        .bind(user)
        .first<{ n: number }>()
    )?.n,
    0,
  );
});
test('owner isolation and foreign keys reject another account or a missing word', async () => {
  const a = await fixture(),
    b = await fixture();
  await review.snapshot(b.user);
  await assert.rejects(
    review.apply(b.user, {
      action: 'enroll',
      entryIds: [a.entry.id],
      enrolledAt: a.entry.updatedAt,
    }),
    ReviewConflict,
  );
  await assert.rejects(
    review.apply(a.user, {
      action: 'enroll',
      entryIds: [a.entry.id, 'missing-word'],
      enrolledAt: a.entry.updatedAt,
    }),
    ReviewConflict,
  );
  assert.deepEqual((await review.snapshot(a.user)).cards, []);
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
test('deleting vocabulary and accounts cascades review cards', async () => {
  const { user, entry } = await fixture();
  await review.apply(user, {
    action: 'enroll',
    entryIds: [entry.id],
    enrolledAt: entry.updatedAt,
  });
  await dictionary.remove(user, entry.id);
  assert.equal((await review.snapshot(user)).cards.length, 0);
  await db.prepare('DELETE FROM "user" WHERE id=?').bind(user).run();
  assert.equal(
    (
      await db
        .prepare('SELECT count(*) AS n FROM user_review_states WHERE user_id=?')
        .bind(user)
        .first<{ n: number }>()
    )?.n,
    0,
  );
});
test('review API bounds and validates writes, rejects unverified mutations, and uses private cache headers', async () => {
  const { user, entry } = await fixture();
  const req = (body: unknown) =>
    new Request('https://example.com/api/review', { method: 'POST', body: JSON.stringify(body) });
  const enroll = { action: 'enroll', entryIds: [entry.id], enrolledAt: entry.updatedAt };
  assert.equal((await handleReviewRequest(req(enroll), user, false, review)).status, 403);
  // Deck operations from tabs still running an older bundle are acknowledged without effect,
  // so those tabs' outboxes keep draining instead of retrying a rejected operation forever.
  for (const body of [
    { action: 'deck', id: 'd', name: 'Deck' },
    { action: 'delete-deck', deckId: 'd' },
    { action: 'membership', deckId: 'inbox', entryIds: [entry.id], remove: false },
  ])
    assert.equal((await handleReviewRequest(req(body), user, true, review)).status, 200);
  assert.equal((await review.snapshot(user)).cards.length, 0);
  for (const body of [
    null,
    { action: 'enroll', entryIds: ['word'], enrolledAt: 'bad' },
    { action: 'grade', entryId: 'word', revision: -1, grade: 'good' },
  ])
    assert.equal((await handleReviewRequest(req(body), user, true, review)).status, 400);
  // An enroll queued offline before decks were removed still applies; its deck is ignored.
  assert.equal(
    (await handleReviewRequest(req({ ...enroll, deckId: 'inbox' }), user, true, review)).status,
    200,
  );
  assert.equal((await review.snapshot(user)).cards.length, 1);
  const response = await handleReviewRequest(
    new Request('https://example.com/api/review'),
    user,
    true,
    review,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  // Older bundles read deck lists from the snapshot; they stay present and empty.
  const snapshot = await response.json();
  assert.deepEqual([snapshot.decks, snapshot.memberships], [[], []]);
  assert.equal(snapshot.cards.length, 1);
  assert.equal(
    (await handleReviewRequest(req({ ...enroll, padding: 'x'.repeat(17000) }), user, true, review))
      .status,
    413,
  );
});

test('enrolling a full 100-word batch stays within the D1 bound-parameter limit', async () => {
  const { user, entry } = await fixture();
  const ids = [entry.id];
  for (let n = 1; n < 100; n++)
    ids.push(
      (
        await dictionary.save(user, {
          schemaVersion: 1,
          term: `語${n}`,
          reading: null,
          translation: 'word',
          sourceSentence: demo.segments[0].japanese,
          sourceSentenceTranslation: demo.segments[0].translation,
          source: await dictionarySource(demo as Lesson, demo.segments[0]),
        })
      ).id,
    );
  // Production D1 rejects statements with more than 100 bound values; local SQLite does not.
  const guarded = new Proxy(db, {
    get(target, property) {
      if (property === 'prepare')
        return (sql: string) => {
          const statement = target.prepare(sql);
          return new Proxy(statement, {
            get(inner, key) {
              if (key === 'bind')
                return (...values: unknown[]) => {
                  assert.ok(values.length <= 100, `${values.length} bound values: ${sql}`);
                  return inner.bind(...values);
                };
              const value = Reflect.get(inner, key);
              return typeof value === 'function' ? value.bind(inner) : value;
            },
          });
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await createD1ReviewRepository(guarded).apply(user, {
    action: 'enroll',
    entryIds: ids,
    enrolledAt: entry.updatedAt,
  });
  assert.equal((await review.snapshot(user)).cards.length, 100);
});
