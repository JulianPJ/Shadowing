import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Real persisted workerd/D1, independent of production bindings and CLI process lifetime.
const files = (await readdir('migrations')).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();
await mkdir('artifacts', { recursive: true });
const mf = new Miniflare(
  convertV4MiniflareOptions({
    modules: true,
    script: 'export default { fetch() { return new Response("migration verification"); } }',
    compatibilityDate: '2026-10-03',
    d1Databases: { HIBIKI_DB: 'migration-verification' },
    d1Persist: '.cloudflare/migration-verification',
  }),
);
try {
  const db = await mf.getD1Database('HIBIKI_DB');
  await db
    .prepare(
      'CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE NOT NULL, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)',
    )
    .run();
  const applied = new Set(
    (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map(
      (row) => row.name,
    ),
  );
  for (const name of files) {
    if (applied.has(name)) continue;
    const sql = await readFile('migrations/' + name, 'utf8');
    // Committed migrations contain simple statements, without embedded semicolons.
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter(Boolean);
    await db.batch([
      ...statements.map((s) => db.prepare(s)),
      db.prepare('INSERT INTO d1_migrations(name) VALUES (?)').bind(name),
    ]);
  }
  const ledger = (await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map(
    (row) => row.name,
  );
  assert.deepEqual(ledger, files);
  const foreignKeyCheck = (await db.prepare('PRAGMA foreign_key_check').all()).results;
  assert.deepEqual(foreignKeyCheck, []);
  const preferenceColumns = (await db.prepare('PRAGMA table_info(user_preferences)').all()).results;
  const reviewLimitsColumn = preferenceColumns.find(
    (column) => column.name === 'review_limits_json',
  );
  assert.ok(reviewLimitsColumn);
  assert.equal(reviewLimitsColumn.notnull, 0);
  const ownership = (await db.prepare('PRAGMA foreign_key_list(user_dictionary_tags)').all())
    .results;
  for (const table of ['user_tags', 'user_dictionary_entries']) {
    assert.ok(
      ownership.some(
        (fk) =>
          fk.table === table &&
          fk.from === 'user_id' &&
          fk.to === 'user_id' &&
          fk.on_delete === 'CASCADE',
      ),
    );
    assert.ok(
      ownership.some(
        (fk) =>
          fk.table === table &&
          fk.from !== 'user_id' &&
          fk.to === 'id' &&
          fk.on_delete === 'CASCADE',
      ),
    );
  }
  await writeFile(
    'artifacts/local-d1-migrations.json',
    JSON.stringify({ ledger, foreignKeyCheck, ownership, reviewLimitsColumn }, null, 2),
  );
  console.log(
    `Real local D1: ${ledger.length} migrations applied; ledger and composite ownership FKs verified; foreign_key_check empty.`,
  );
} finally {
  await mf.dispose();
}
