import { installMemoryStorage } from './helpers/memory-storage';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadPreferences } from '../src/lib/storage/preferences';
import { writeStorage } from '../src/lib/storage/browser';

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
    subtitleOverlay: false,
    playbackOffsetMs: 0,
  });
  writeStorage('preferences', { mode: 'continuous', speed: 0.75, translation: true });
  assert.deepEqual(loadPreferences(), {
    mode: 'continuous',
    speed: 0.75,
    translation: false,
    studioMode: false,
    furigana: false,
    subtitleOverlay: false,
    playbackOffsetMs: 0,
  });
});
test('display and playback offset preferences persist using the existing versioned preferences key', () => {
  const prefs = {
    mode: 'continuous',
    speed: 1.25,
    translation: false,
    studioMode: true,
    furigana: true,
    subtitleOverlay: true,
    playbackOffsetMs: 350,
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
      subtitleOverlay: false,
      playbackOffsetMs: 0,
    });
  }
});

test('playback offset accepts bounded millisecond values and rejects corrupt values', () => {
  for (const playbackOffsetMs of [-2000, -375, 0, 425, 2000]) {
    writeStorage('preferences', { mode: 'shadowing', speed: 1, playbackOffsetMs });
    assert.equal(loadPreferences().playbackOffsetMs, playbackOffsetMs);
  }
  for (const playbackOffsetMs of [-2001, 2001, Number.POSITIVE_INFINITY, '200']) {
    writeStorage('preferences', { mode: 'shadowing', speed: 1, playbackOffsetMs });
    assert.equal(loadPreferences().playbackOffsetMs, 0);
  }
});
