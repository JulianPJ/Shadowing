import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { getMigrations } from 'better-auth/db/migration';
import { createAuth } from '../src/lib/auth/server';

// Production disables Better Auth's runtime schema validation (it introspects every D1 table in
// each new isolate), so the committed migrations are checked against Better Auth's schema here.
test('migrations provide every table, column and index Better Auth expects', async () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const file of (await readdir('migrations')).filter((f) => f.endsWith('.sql')).sort())
    db.exec(await readFile(`migrations/${file}`, 'utf8'));
  const auth = createAuth(db, {
    AUTH_SECRET: 'schema-test-placeholder-secret-32-characters',
    AUTH_BASE_URL: 'http://localhost:3000',
  });
  assert.equal(auth.options.advanced?.database?.validateSchema, false);
  const plan = await getMigrations(auth.options);
  assert.deepEqual(plan.toBeCreated, []);
  assert.deepEqual(plan.toBeAdded, []);
  assert.deepEqual(plan.toBeAddedIndexes, []);
  assert.deepEqual(plan.unsafeChanges, []);
  assert.deepEqual(plan.schemaProblems, []);
});
