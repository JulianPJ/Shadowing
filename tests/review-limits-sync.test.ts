import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { installMemoryStorage } from './helpers/memory-storage';
import { readStorage, setStorageAccount, writeStorage } from '../src/lib/storage/browser';
import { loadPreferences } from '../src/lib/storage/preferences';
import { loadStudyLimits, saveStudyLimits } from '../src/lib/review/study-settings';
import { normalizeReviewLimits, validateReviewLimits } from '../src/lib/review/limits';
import { createD1UserProgressRepository } from '../src/lib/sync/repository';
import { localProgressDatabase } from './helpers/sqlite-d1';
import { deviceSnapshot } from '../src/lib/sync/snapshot';
import { hydrateSync } from '../src/lib/sync/hydrate';
import { emptySync } from '../src/lib/sync/types';
import { validateSync } from '../src/lib/sync/validation';
import { mergeSync } from '../src/lib/sync/merge';

const date = '2026-10-07T10:00:00.000Z';
const limits = { defaults: { new: 20, review: 100 }, decks: { travel: { new: 5, review: 25 } } };
const single = { defaults: limits.defaults, decks: {} };

test('strict synced review limits reject malformed, oversized and extra-field shapes; local fallback is bounded', () => {
  assert.deepEqual(validateReviewLimits(limits), limits);
  for (const value of [
    null,
    [],
    { defaults: [], decks: {} },
    { ...limits, extensions: { all: '2026-10-07' } },
    { ...limits, decks: [] },
    { defaults: { new: -1, review: null }, decks: {} },
    { defaults: { new: 10001, review: null }, decks: {} },
    { ...limits, decks: { travel: 'unlimited' } },
    {
      ...limits,
      decks: Object.fromEntries(
        Array.from({ length: 101 }, (_, id) => [String(id), limits.defaults]),
      ),
    },
  ])
    assert.throws(() => validateReviewLimits(value), /Invalid review limits/);
  assert.deepEqual(normalizeReviewLimits({ defaults: { new: -1, review: '10' }, decks: [] }), {
    defaults: { new: null, review: null },
    decks: {},
  });
  assert.throws(() =>
    validateReviewLimits(
      JSON.parse(
        '{"defaults":{"new":null,"review":null},"decks":{"__proto__":{"new":1,"review":2}}}',
      ),
    ),
  );
});

test('legacy study settings remain readable and saving limits enters the existing preference sync envelope', async () => {
  installMemoryStorage();
  setStorageAccount(null);
  writeStorage('review:study-settings', { ...limits, extensions: { all: '2026-10-07' } });
  assert.deepEqual(loadStudyLimits(), limits.defaults);
  assert.equal(loadPreferences().reviewLimits, undefined);
  saveStudyLimits(loadStudyLimits());
  // Deck overrides are gone; the envelope keeps its shape for older clients.
  assert.deepEqual(loadPreferences().reviewLimits, single);
  const before = readStorage('preferences', null);
  saveStudyLimits(loadStudyLimits());
  assert.deepEqual(readStorage('preferences', null), before);
  const snapshot = await deviceSnapshot();
  assert.deepEqual(snapshot.preferences?.reviewLimits, single);
  assert.equal('extensions' in snapshot.preferences!.reviewLimits!, false);
});

test('two device snapshots round-trip daily limits through the actual SQL preference repository while timing stays local', async () => {
  const db = new DatabaseSync(':memory:');
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });
  try {
    for (const file of ['0002_auth.sql', '0003_user_sync.sql'])
      db.exec(readFileSync(`migrations/${file}`, 'utf8'));
    db.exec(
      `INSERT INTO "user"(id,name,email,emailVerified,createdAt,updatedAt) VALUES ('learner','Learner','learner@example.com',1,0,0)`,
    );
    db.exec(
      `INSERT INTO user_preferences(user_id,schema_version,mode,speed,studio_mode,furigana,updated_at) VALUES ('learner',1,'shadowing',1,0,0,'2026-10-06T10:00:00.000Z')`,
    );
    db.exec(readFileSync('migrations/0010_review_limits.sql', 'utf8'));
    const repository = createD1UserProgressRepository(localProgressDatabase(db));
    const upgraded = await repository.bootstrap('learner');
    assert.equal(upgraded.data.preferences?.reviewLimits, undefined);
    assert.equal(upgraded.data.preferences?.mode, 'shadowing');
    const deviceA = new Map<string, string>(),
      deviceB = new Map<string, string>();
    installMemoryStorage(deviceA);
    setStorageAccount('learner');
    saveStudyLimits(limits.defaults);
    writeStorage('sync:preferences-date', date);
    const a = validateSync(await deviceSnapshot());
    await repository.push('learner', a);
    const remote = (await repository.bootstrap('learner')).data;
    assert.deepEqual(remote.preferences?.reviewLimits, single);
    installMemoryStorage(deviceB);
    writeStorage('preferences', {
      ...loadPreferences(),
      playbackOffsetMs: 250,
      subtitleOverlay: true,
    });
    await hydrateSync(remote);
    assert.deepEqual(loadStudyLimits(), limits.defaults);
    assert.equal(loadPreferences().playbackOffsetMs, 250);
    assert.equal(loadPreferences().subtitleOverlay, true);
    assert.equal('subtitleOverlay' in validateSync(await deviceSnapshot()).preferences!, false);
    const changed = { defaults: { new: 12, review: 80 }, decks: {} };
    saveStudyLimits(changed.defaults);
    writeStorage('sync:preferences-date', '2026-10-07T10:00:01.000Z');
    await repository.push('learner', validateSync(await deviceSnapshot()));
    installMemoryStorage(deviceA);
    await hydrateSync((await repository.bootstrap('learner')).data);
    assert.deepEqual(loadStudyLimits(), changed.defaults);
    const legacy = {
      ...emptySync(),
      preferences: {
        schemaVersion: 1 as const,
        mode: 'continuous' as const,
        speed: 1,
        studioMode: true,
        furigana: false,
        updatedAt: '2026-10-07T10:00:02.000Z',
      },
    };
    await repository.push('learner', legacy);
    assert.deepEqual(
      (await repository.bootstrap('learner')).data.preferences?.reviewLimits,
      changed,
    );
    assert.deepEqual(mergeSync(await deviceSnapshot(), legacy).preferences?.reviewLimits, changed);
    assert.equal((await repository.bootstrap('other')).data.preferences, null);
  } finally {
    setStorageAccount(null);
    db.close();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  }
});
