import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { D1Database } from '../src/lib/d1';
import { createD1DictionaryRepository } from '../src/lib/dictionary/repository';
import { externalReplay, reviewContextHref } from '../src/lib/dictionary/replay';
import { vocabularyRows } from '../src/lib/export/vocabulary';

// Words imported from Anki (by the removed importer or a manual insert) stay readable:
// text-only sources, collection pages, exports and cascading deletes.
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default {fetch(){return new Response("ok")}}',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'imported-collections-tests' },
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

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
async function importedWord(userId: string, term: string, deck: string) {
  const id = crypto.randomUUID(),
    key = sha(term),
    now = new Date().toISOString();
  await db.batch([
    db
      .prepare('INSERT OR IGNORE INTO user_vocabulary_collections(user_id,id,name) VALUES (?,?,?)')
      .bind(userId, sha(deck), deck),
    db
      .prepare(
        `INSERT INTO user_dictionary_entries(user_id,id,schema_version,term,normalized_term,reading,translation,source_sentence,source_sentence_translation,lesson_id,segment_id,lesson_title,lesson_author,media_type,transcript_key,section_start,section_end,created_at,updated_at,import_source) VALUES (?,?,1,?,?,'ねこ','cat','猫です。','A cat.','',?,?,'Anki','local','',0,0,?,?,?)`,
      )
      .bind(
        userId,
        id,
        term,
        term,
        key,
        deck,
        now,
        now,
        JSON.stringify({ kind: 'anki', collection: deck, contentKey: key }),
      ),
    db
      .prepare(
        'INSERT INTO user_vocabulary_memberships(user_id,collection_id,entry_id,created_at) VALUES (?,?,?,?)',
      )
      .bind(userId, sha(deck), id, now),
  ]);
  return id;
}

test('imported Anki words are text-only, paged by collection and cascade on delete', async () => {
  const userId = crypto.randomUUID();
  await db
    .prepare(
      'INSERT INTO user(id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,0,0)',
    )
    .bind(userId, 'Learner', userId + '@example.com')
    .run();
  const repository = createD1DictionaryRepository(db);
  const first = await importedWord(userId, '猫', 'Core JP9K');
  await importedWord(userId, '犬', 'Refold JP1K v3');

  const [saved] = (await repository.page(userId, { collectionId: sha('Core JP9K') })).entries;
  assert.equal(saved.id, first);
  assert.equal(saved.source.kind, 'anki');
  assert.equal(saved.source.lessonId, '');
  assert.equal(externalReplay(saved), null);
  assert.match(reviewContextHref(saved), /^\/vocabulary\?word=/);
  assert.equal(vocabularyRows([saved])[0].start, '');
  assert.equal(
    (await repository.page(crypto.randomUUID(), { collectionId: sha('Core JP9K') })).entries.length,
    0,
  );

  await repository.remove(userId, first);
  assert.equal(
    (await repository.page(userId, { collectionId: sha('Core JP9K') })).entries.length,
    0,
  );
  await db.prepare('DELETE FROM user WHERE id=?').bind(userId).run();
  for (const table of ['user_vocabulary_collections', 'user_vocabulary_memberships'])
    assert.equal(
      (await db.prepare(`SELECT * FROM ${table} WHERE user_id=?`).bind(userId).all()).results
        .length,
      0,
    );
});
