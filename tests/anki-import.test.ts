import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import initSqlJs from 'sql.js';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '../src/lib/d1';
import { ankiFixture } from './helpers/anki-fixtures';
import { expandZstd, parsePackage } from '../src/lib/anki/package';
import { fieldText, mappedRecords, suggestMapping } from '../src/lib/anki/normalize';
import {
  contentHash,
  handleAnkiRequest,
  importBatch,
  validateImportRecord,
} from '../src/lib/anki/server';
import type { ImportRecord } from '../src/lib/anki/types';
import { createD1DictionaryRepository } from '../src/lib/dictionary/repository';
import { createD1ReviewRepository } from '../src/lib/review/repository';
import { vocabularyRows } from '../src/lib/export/vocabulary';
import { externalReplay, reviewContextHref } from '../src/lib/dictionary/replay';
import { accountRouteFeature } from '../src/lib/access';
import { accountHandler } from '../src/lib/sync/server';
import { createD1UserProgressRepository } from '../src/lib/sync/repository';
import type { HibikiAuth } from '../src/lib/auth/server';

for (const format of ['legacy', 'legacy21', 'current'] as const)
  test(`${format} package: decks, note types, media, scheduling and mapping`, async () => {
    const pkg = await parsePackage(await ankiFixture(format), await initSqlJs());
    assert.deepEqual(pkg.decks, ['Japanese', 'Japanese::Daily']);
    assert.equal(pkg.models.length, 2);
    assert.equal(pkg.notes.length, 3);
    assert.equal(pkg.media, true);
    const maps = Object.fromEntries(pkg.models.map((m) => [m.id, suggestMapping(m)]));
    const mapped = mappedRecords(pkg, pkg.decks, maps, 'interval', 21);
    assert.equal(mapped.records[0].term, '猫');
    assert.equal(mapped.records[0].state, 'learning');
    assert.equal(mapped.records[1].state, 'known');
    assert.equal(mapped.records[2].state, 'learning');
    assert.equal(mapped.records[0].translation, 'cat');
    assert.equal(mappedRecords(pkg, ['Japanese'], maps, 'interval', 21).records[0].state, 'known');
    assert.ok(
      mappedRecords(pkg, pkg.decks, maps, 'known', 21).records.every((r) => r.state === 'known'),
    );
    assert.ok(
      mappedRecords(pkg, pkg.decks, maps, 'learning', 21).records.every(
        (r) => r.state === 'learning',
      ),
    );
    assert.equal(mappedRecords(pkg, pkg.decks, maps, 'interval', 31).records[1].state, 'learning');
    const broken = { ...pkg, notes: [{ ...pkg.notes[0], fields: [''] }] };
    assert.equal(mappedRecords(broken, pkg.decks, maps, 'known', 21).skipped, 1);
    assert.throws(() => mappedRecords(pkg, pkg.decks, maps, 'interval', 0));
  });
test('untrusted fields are text and malformed or oversized packages fail closed', async () => {
  assert.equal(
    fieldText('<img src=x onerror=alert(1)>猫<br>です。[sound:a.mp3]<script>alert(1)</script>'),
    '猫\nです。',
  );
  assert.equal(fieldText('&lt;script&gt; &amp; &#x732b;'), '\x3cscript> & 猫');
  assert.throws(() => validateImportRecord({ ...record(), term: '<script>猫' }));
  assert.throws(() => validateImportRecord({ ...record(), reading: 'x'.repeat(121) }));
  assert.throws(() => expandZstd(new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0, 0xff, 1, 0, 0])));
  await assert.rejects(parsePackage(new Blob(['not a zip']), await initSqlJs()));
  await assert.rejects(parsePackage({ size: 129 * 1024 * 1024 } as Blob, await initSqlJs()));
});
test('large modern package and exports without scheduling retain text without inventing intervals', async () => {
  const SQL = await initSqlJs();
  const large = await parsePackage(await ankiFixture('current', 5000), SQL);
  assert.equal(large.notes.length, 5000);
  const plain = await parsePackage(await ankiFixture('current', 3, false), SQL);
  assert.equal(plain.scheduling, false);
  const maps = Object.fromEntries(plain.models.map((m) => [m.id, suggestMapping(m)]));
  const mapped = mappedRecords(plain, plain.decks, maps, 'interval', 21);
  assert.ok(mapped.records.every((r) => r.state === 'learning'));
  assert.equal(mapped.missingIntervals, 3);
  const extra = {
    ...plain,
    notes: [
      plain.notes[0],
      {
        ...plain.notes[0],
        id: 'different',
        fields: ['猫', 'ねこ', 'another sense', '別の文。'],
        cards: [{ deck: 'Japanese', interval: 30 }],
      },
    ],
  };
  const result = mappedRecords(extra, extra.decks, maps, 'interval', 21);
  assert.ok(result.records.every((r) => r.state === 'learning'));
});

const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'anki-import-tests' },
  }),
);
let db: D1Database;
before(async () => {
  db = await mf.getD1Database('HIBIKI_DB');
  for (const name of (await readdir('migrations')).filter((n) => n.endsWith('.sql')).sort())
    await db.batch(
      (await readFile('migrations/' + name, 'utf8'))
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => db.prepare(s)),
    );
});
after(() => mf.dispose());
async function user() {
  const id = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
    )
    .bind(id, 'Learner', id + '@example.com')
    .run();
  return id;
}
function record(term = '猫', state: 'known' | 'learning' = 'learning'): ImportRecord {
  return {
    term,
    reading: 'ねこ',
    translation: 'cat',
    sourceSentence: '猫です。',
    sourceSentenceTranslation: 'A cat.',
    decks: ['Japanese::Daily'],
    state,
  };
}
test('atomic text import, repeat, additional membership, no video/export or foreign-account leakage', async () => {
  const id = await user();
  const r = record();
  const a = await importBatch(db, id, [r], true, false);
  assert.equal(a.imported, 1);
  const repository = createD1DictionaryRepository(db);
  const saved = (await repository.page(id, {})).entries[0];
  assert.equal(saved.source.kind, 'anki');
  assert.equal(saved.source.lessonId, '');
  assert.equal(saved.source.transcriptKey, '');
  assert.equal(externalReplay(saved), null);
  assert.match(reviewContextHref(saved), /^\/vocabulary\?word=/);
  assert.equal(vocabularyRows([saved])[0].start, '');
  const before = (
    await db.prepare('SELECT * FROM user_review_states WHERE user_id=?').bind(id).all()
  ).results;
  const b = await importBatch(
    db,
    id,
    [{ ...r, state: 'known', decks: ['Japanese::Other'] }],
    true,
    false,
  );
  assert.equal(b.imported, 0);
  assert.equal(b.duplicates, 1);
  assert.deepEqual(
    (await db.prepare('SELECT * FROM user_review_states WHERE user_id=?').bind(id).all()).results,
    before,
  );
  assert.equal(
    (await db.prepare('SELECT * FROM user_vocabulary_memberships WHERE user_id=?').bind(id).all())
      .results.length,
    2,
  );
  assert.equal(
    (await repository.page(id, { collectionId: await contentHash('Japanese::Other') })).entries
      .length,
    1,
  );
  assert.equal(
    (await repository.page(await user(), { collectionId: await contentHash('Japanese::Other') }))
      .entries.length,
    0,
  );
  assert.equal(accountRouteFeature('/api/vocabulary/import'), 'vocabulary');
  assert.equal(accountRouteFeature('/api/vocabulary/collections'), 'vocabulary');
  const request = new Request('https://example.com/api/vocabulary/import', {
    method: 'POST',
    body: JSON.stringify({ action: 'import', records: [r], distinct: false }),
  });
  assert.equal((await handleAnkiRequest(request, id, false, db)).status, 403);
  await db.prepare('DELETE FROM user WHERE id=?').bind(id).run();
  assert.equal(
    (await db.prepare('SELECT * FROM user_vocabulary_collections WHERE user_id=?').bind(id).all())
      .results.length,
    0,
  );
});
test('existing Known Learning Ignored choices and multiple contexts never duplicate active schedules', async () => {
  const id = await user();
  for (const state of ['known', 'learning', 'ignored'] as const) {
    const term = '猫' + state;
    await db
      .prepare(
        'INSERT INTO user_word_knowledge(user_id,lemma,state,updated_at,synced_at) VALUES (?,?,?,?,?)',
      )
      .bind(id, term, state, new Date().toISOString(), new Date().toISOString())
      .run();
    await importBatch(db, id, [record(term)], true, false);
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM user_word_knowledge WHERE user_id=? AND lemma=?')
          .bind(id, term)
          .first<{ state: string }>()
      )?.state,
      state,
    );
  }
  assert.equal(
    (await db.prepare('SELECT * FROM user_review_states WHERE user_id=?').bind(id).all()).results
      .length,
    1,
  );
  const r = record('猫learning');
  const changed = { ...r, translation: 'another sense' };
  assert.equal((await importBatch(db, id, [changed], false, false)).skipped, 1);
  assert.equal((await importBatch(db, id, [changed], true, false)).skipped, 1);
  assert.equal((await importBatch(db, id, [changed], true, true)).imported, 1);
  assert.equal(
    (await db.prepare('SELECT * FROM user_review_states WHERE user_id=?').bind(id).all()).results
      .length,
    1,
  );
});
test('transaction failure rolls back; a lost response and retry cannot reset an edited word', async () => {
  const id = await user(),
    r = record();
  let failed = false;
  const broken = new Proxy(db, {
    get(target, key) {
      if (key === 'batch')
        return async () => {
          throw new Error('interruption');
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  try {
    await importBatch(broken, id, [r], true, false);
  } catch {
    failed = true;
  }
  assert.equal(failed, true);
  assert.equal((await createD1DictionaryRepository(db).list(id)).length, 0);
  await importBatch(db, id, [r], true, false);
  await db
    .prepare("UPDATE user_dictionary_entries SET translation='learner edit' WHERE user_id=?")
    .bind(id)
    .run();
  assert.equal((await importBatch(db, id, [r], true, false)).duplicates, 1);
  assert.equal((await createD1DictionaryRepository(db).list(id))[0].translation, 'learner edit');
});
test('account boundary enforces Pro, verified email, origin and expected owner; Free raw export retains imported collections', async () => {
  const id = await user();
  let verified = true;
  let pro = true;
  const auth = {
    api: {
      getSession: async () => ({
        user: { id, emailVerified: verified, adultSelfDeclaredAt: new Date() },
      }),
    },
  } as unknown as HibikiAuth;
  const handler = accountHandler({
    auth,
    progress: createD1UserProgressRepository(db),
    db,
    env: { AUTH_BASE_URL: 'https://example.com' },
    access: { plan: async () => (pro ? 'pro' : 'free') },
    dictionary: createD1DictionaryRepository(db),
  });
  const request = (origin = 'https://example.com', owner = id) =>
    new Request('https://example.com/api/vocabulary/import', {
      method: 'POST',
      headers: { origin, 'Content-Type': 'application/json', 'X-Hibiki-Account': owner },
      body: JSON.stringify({ action: 'import', records: [record()], distinct: false }),
    });
  pro = false;
  assert.equal((await handler(request())).status, 403);
  pro = true;
  verified = false;
  assert.equal((await handler(request())).status, 403);
  verified = true;
  assert.equal((await handler(request('https://other.example'))).status, 403);
  assert.equal((await handler(request('https://example.com', 'another-user'))).status, 409);
  assert.equal((await handler(request())).status, 200);
  pro = false;
  const response = await handler(new Request('https://example.com/api/account/export'));
  assert.equal(response.status, 200);
  const exported = await response.json();
  assert.equal(exported.vocabulary[0].source.kind, 'anki');
  assert.equal(exported.importedCollections.length, 1);
  assert.equal(exported.importedMemberships.length, 1);
  assert.equal(exported.importedIdentities.length, 1);
  assert.equal(exported.importUsage[0].contexts, 1);
  pro = true;
  const page = await (
    await handler(new Request('https://example.com/api/vocabulary/collections'))
  ).json();
  assert.equal(page.collections.length, 1);
  assert.equal(page.nextCursor, null);
});
test('normalized import request rejects malformed roots, invalid fields and excessive request bodies', async () => {
  const id = await user();
  for (const value of [
    null,
    [],
    { action: 'import', records: [{ ...record(), term: '' }], distinct: false },
  ]) {
    const request = new Request('https://example.com/api/vocabulary/import', {
      method: 'POST',
      body: JSON.stringify(value),
    });
    assert.equal((await handleAnkiRequest(request, id, true, db)).status, 400);
  }
  assert.equal(
    (
      await handleAnkiRequest(
        new Request('https://example.com/api/vocabulary/import', { method: 'POST', body: '{' }),
        id,
        true,
        db,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await handleAnkiRequest(
        new Request('https://example.com/api/vocabulary/import', {
          method: 'POST',
          body: 'x'.repeat(128001),
        }),
        id,
        true,
        db,
      )
    ).status,
    413,
  );
});
test('daily quota permits safe repeats, rejects further new words and keeps a batch below Free query limits', async () => {
  const id = await user();
  await importBatch(db, id, [record()], true, false);
  await db
    .prepare('UPDATE user_vocabulary_import_usage SET contexts=1000 WHERE user_id=?')
    .bind(id)
    .run();
  assert.equal((await importBatch(db, id, [record()], true, false)).duplicates, 1);
  await assert.rejects(importBatch(db, id, [record('犬')], true, false), /Daily import limit/);
  const fresh = await user();
  let count = 0;
  const counted = new Proxy(db, {
    get(target, key) {
      if (key === 'prepare')
        return (sql: string) => {
          count++;
          return target.prepare(sql);
        };
      const value = Reflect.get(target, key, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  await importBatch(
    counted,
    fresh,
    [
      { ...record('一'), decks: ['a', 'b', 'c'] },
      { ...record('二'), decks: ['a', 'b', 'c'] },
      { ...record('三'), decks: ['a', 'b'] },
    ],
    true,
    false,
  );
  assert.ok(count <= 46, `queries: ${count}`);
});
test('deletion and later re-import cannot retarget an old client review operation', async () => {
  const id = await user(),
    repository = createD1DictionaryRepository(db);
  await importBatch(db, id, [record()], true, false);
  const before = (await repository.list(id))[0];
  await repository.remove(id, before.id);
  await importBatch(db, id, [record()], true, false);
  const after = (await repository.list(id))[0];
  assert.notEqual(after.id, before.id);
  assert.equal(after.source.contentKey, before.source.contentKey);
  await assert.rejects(
    createD1ReviewRepository(db).apply(id, {
      action: 'grade',
      entryId: before.id,
      revision: 0,
      operationId: crypto.randomUUID(),
      reviewedAt: new Date().toISOString(),
      grade: 'again',
    }),
    /removed/,
  );
});
test('legacy entries with no explicit word-state row keep their implied Known or Learning choice', async () => {
  const id = await user();
  for (const state of ['known', 'learning'] as const) {
    const r = record('語' + state, state);
    await importBatch(db, id, [r], true, false);
    await db
      .prepare('DELETE FROM user_word_knowledge WHERE user_id=? AND lemma=?')
      .bind(id, r.term)
      .run();
    await importBatch(
      db,
      id,
      [{ ...r, translation: 'distinct context', state: state === 'known' ? 'learning' : 'known' }],
      true,
      true,
    );
    assert.equal(
      (
        await db
          .prepare('SELECT state FROM user_word_knowledge WHERE user_id=? AND lemma=?')
          .bind(id, r.term)
          .first<{ state: string }>()
      )?.state,
      state,
    );
  }
});
test('representative D1 rows for small and large imports, repeats and bounded dashboard reads', async () => {
  const measurements = [];
  for (const count of [10, 500]) {
    const id = await user();
    const records = Array.from({ length: count }, (_, i) => record('語' + i));
    let read = 0,
      written = 0,
      repeatRead = 0,
      repeatWritten = 0;
    for (let i = 0; i < records.length; i += 3) {
      const result = await importBatch(db, id, records.slice(i, i + 3), true, false);
      read += result.rowsRead;
      written += result.rowsWritten;
    }
    for (let i = 0; i < records.length; i += 3) {
      const result = await importBatch(db, id, records.slice(i, i + 3), true, false);
      repeatRead += result.rowsRead;
      repeatWritten += result.rowsWritten;
    }
    assert.equal(repeatWritten, 0);
    assert.ok(written < count * 25);
    const page = await db
      .prepare(
        'SELECT * FROM user_dictionary_entries WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 101',
      )
      .bind(id)
      .all();
    const collections = await db
      .prepare(
        'SELECT id,name FROM user_vocabulary_collections WHERE user_id=? ORDER BY name LIMIT 1001',
      )
      .bind(id)
      .all();
    const collectionPage = await db
      .prepare(
        'SELECT e.* FROM user_vocabulary_memberships m JOIN user_dictionary_entries e ON e.user_id=m.user_id AND e.id=m.entry_id WHERE m.user_id=? AND m.collection_id=? ORDER BY m.created_at DESC,m.entry_id DESC LIMIT 101',
      )
      .bind(id, await contentHash(records[0].decks[0]))
      .all();
    assert.ok(
      collectionPage.meta.rows_read <= 205,
      `collection page scanned ${collectionPage.meta.rows_read}`,
    );
    const repository = createD1DictionaryRepository(db);
    const first = await repository.page(id, {
      collectionId: await contentHash(records[0].decks[0]),
    });
    assert.equal(first.entries.length, Math.min(count, 100));
    if (count > 100) {
      const second = await repository.page(id, {
        collectionId: await contentHash(records[0].decks[0]),
        cursor: first.nextCursor,
      });
      assert.equal(second.entries.length, 100);
      assert.ok(!second.entries.some((e) => first.entries.some((f) => f.id === e.id)));
    }
    measurements.push({
      contexts: count,
      import: { rowsRead: read, rowsWritten: written },
      repeat: { rowsRead: repeatRead, rowsWritten: repeatWritten },
      dashboardMaterial: {
        rowsRead: page.meta.rows_read + collections.meta.rows_read,
        rowsWritten: 0,
      },
      collectionMaterial: { rowsRead: collectionPage.meta.rows_read, rowsWritten: 0 },
      note: 'Excludes existing auth/review/knowledge channel reads.',
    });
  }
  await mkdir('artifacts', { recursive: true });
  await writeFile('artifacts/anki-d1-usage.json', JSON.stringify(measurements, null, 2));
  console.log('Anki D1 usage:', JSON.stringify(measurements));
});
