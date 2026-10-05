import { installMemoryStorage } from './helpers/memory-storage';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreferences, writeStorage } from '../src/lib/storage';

const values = new Map<string, string>();
installMemoryStorage(values);
test('display preferences default off and old saved mode/speed survive', () => {
  values.clear();
  assert.deepEqual(loadPreferences(), {
    mode: 'shadowing',
    speed: 1,
    translation: false,
    studioMode: false,
    furigana: false,
  });
  writeStorage('preferences', { mode: 'continuous', speed: 0.75, translation: true });
  assert.deepEqual(loadPreferences(), {
    mode: 'continuous',
    speed: 0.75,
    translation: false,
    studioMode: false,
    furigana: false,
  });
});
test('both display preferences persist using the existing versioned preferences key', () => {
  const prefs = {
    mode: 'continuous',
    speed: 1.25,
    translation: false,
    studioMode: true,
    furigana: true,
  } as const;
  writeStorage('preferences', prefs);
  assert.deepEqual(loadPreferences(), prefs);
  assert.deepEqual(JSON.parse(values.get('hibiki:v1:preferences')!), prefs);
});
test('corrupt or malformed preferences use strict safe defaults', () => {
  for (const raw of [
    '{',
    'null',
    '[]',
    '12',
    '{"studioMode":"true","furigana":1,"speed":99,"mode":"invalid"}',
  ]) {
    values.set('hibiki:v1:preferences', raw);
    assert.deepEqual(loadPreferences(), {
      mode: 'shadowing',
      speed: 1,
      translation: false,
      studioMode: false,
      furigana: false,
    });
  }
});
