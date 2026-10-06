import assert from 'node:assert/strict';
import { test } from 'node:test';
import { practicePreset, normalizeDrillSettings } from '../src/lib/drill-presets';
import { scoreShadowingAttempt, shadowingAlignmentChunks } from '../src/lib/shadowing-score';
import {
  createShadowingSession,
  upsertShadowingSection,
  saveShadowingSession,
  loadShadowingSession,
  loadAllShadowingSessions,
  shadowingSectionTrend,
  compactShadowingRevision,
  MAX_SHADOWING_HISTORY_BYTES,
} from '../src/lib/shadowing-session';
import { installMemoryStorage, memoryStorage } from './helpers/memory-storage';
import { setStorageAccount, writeStorage } from '../src/lib/storage/browser';

const values = new Map<string, string>();
installMemoryStorage(values);
const tab = new Map<string, string>();
Object.defineProperty(globalThis, 'sessionStorage', {
  configurable: true,
  value: memoryStorage(tab),
});
Object.defineProperty(globalThis, 'window', { configurable: true, value: new EventTarget() });

function result(score: number, attemptedAt = '2026-10-06T10:00:00.000Z') {
  return {
    ...scoreShadowingAttempt({
      targetText: 'こんにちは',
      recognizedText: 'こんにちは',
      referenceDurationSeconds: 4,
      recordingDurationSeconds: 4,
    }),
    sectionId: 's1',
    score,
    attemptedAt,
    suggestions: ['Keep the rhythm.'],
  };
}

test('presets expose repeat, pause and translation policy without affecting score constants', () => {
  assert.deepEqual(practicePreset('focus'), {
    preset: 'focus',
    repeats: 1,
    pause: 'manual',
    reveal: 'manual',
    responseSeconds: 5,
  });
  assert.equal(practicePreset('support').reveal, 'after-pause');
  assert.equal(practicePreset('drill').repeats, 2);
  assert.equal(
    normalizeDrillSettings(
      { preset: 'drill', repeats: 9, responseSeconds: -1, pause: 'mystery' },
      'shadowing',
    ).responseSeconds,
    5,
  );
  assert.equal(normalizeDrillSettings({ preset: 'focus' }, 'continuous').preset, 'continuous');
  assert.equal(normalizeDrillSettings({ preset: 'continuous' }, 'shadowing').preset, 'focus');
});

test('diagnostic chunks group contiguous recognition operations without changing alignment or score', () => {
  const analysis = scoreShadowingAttempt({
    targetText: 'あいうえお',
    recognizedText: 'あいかえ',
    referenceDurationSeconds: 4,
    recordingDurationSeconds: 4,
  });
  const original = structuredClone(analysis.alignment);
  assert.deepEqual(shadowingAlignmentChunks(analysis.alignment), [
    { type: 'match', expected: 'あい', heard: 'あい' },
    { type: 'substitution', expected: 'う', heard: 'か' },
    { type: 'match', expected: 'え', heard: 'え' },
    { type: 'deletion', expected: 'お' },
  ]);
  assert.deepEqual(analysis.alignment, original);
  assert.equal(analysis.score, 68);
});

test('persistent trend survives tab loss, keeps eight valid points, and isolates revisions and accounts', () => {
  values.clear();
  tab.clear();
  setStorageAccount(null);
  let session = createShadowingSession('lesson', '[canonical transcript revision]');
  for (let i = 0; i < 12; i++)
    session = upsertShadowingSection(
      session,
      'lesson',
      '[canonical transcript revision]',
      result(50 + i, `2026-10-06T10:${String(i).padStart(2, '0')}:00.000Z`),
    );
  assert.equal(saveShadowingSession(session), true);
  const durable = values.get('hibiki:v1:shadowing:history')!;
  assert.ok(!durable.includes('こんにちは'));
  assert.ok(!durable.includes('[canonical transcript revision]'));
  assert.equal(
    loadAllShadowingSessions()[0].transcriptRevision,
    compactShadowingRevision('[canonical transcript revision]'),
  );
  tab.clear();
  const restored = loadShadowingSession('lesson', '[canonical transcript revision]');
  assert.deepEqual(restored.sections, {});
  assert.equal(restored.recentAttempts?.s1.length, 8);
  assert.equal(shadowingSectionTrend(restored.recentAttempts?.s1)?.difference, 7);
  assert.deepEqual(loadShadowingSession('lesson', '[changed revision]').recentAttempts, {});
  setStorageAccount('different-account');
  assert.equal(loadAllShadowingSessions().length, 0);
  setStorageAccount(null);
  assert.equal(loadAllShadowingSessions().length, 1);
});

test('trend compares the same speed and rejects malformed durable attempts', () => {
  assert.equal(
    shadowingSectionTrend([
      { ...result(60), referenceDurationSeconds: 4 },
      { ...result(90), referenceDurationSeconds: 8 },
    ]),
    null,
  );
  values.clear();
  tab.clear();
  writeStorage('shadowing:history', [
    {
      schemaVersion: 1,
      lessonId: 'lesson',
      transcriptRevision: compactShadowingRevision('revision'),
      recentAttempts: { s1: [result(55), { ...result(88), score: 999 }, null] },
    },
  ]);
  assert.equal(loadAllShadowingSessions()[0].recentAttempts?.s1.length, 1);
});

test('durable history bounds revisions and bytes; malformed session alignment cannot reach diagnostics', () => {
  values.clear();
  tab.clear();
  for (let i = 0; i < 30; i++) {
    const session = upsertShadowingSection(
      createShadowingSession(`lesson-${i}`, `revision-${i}`),
      `lesson-${i}`,
      `revision-${i}`,
      result(80),
    );
    saveShadowingSession(session);
  }
  assert.equal(loadAllShadowingSessions().length, 24);
  assert.ok(
    new TextEncoder().encode(values.get('hibiki:v1:shadowing:history')!).byteLength <=
      MAX_SHADOWING_HISTORY_BYTES,
  );
  const crowded = Array.from({ length: 24 }, (_, n) => ({
    schemaVersion: 1,
    lessonId: `crowded-${n}`,
    transcriptRevision: compactShadowingRevision(`crowded-revision-${n}`),
    sections: {},
    recentAttempts: Object.fromEntries(
      Array.from({ length: 200 }, (_, i) => [
        `section-${i}`,
        Array.from({ length: 8 }, () => result(75)),
      ]),
    ),
  }));
  writeStorage('shadowing:history', crowded);
  assert.ok(
    new TextEncoder().encode(JSON.stringify(crowded)).byteLength > MAX_SHADOWING_HISTORY_BYTES,
  );
  saveShadowingSession(
    upsertShadowingSection(
      createShadowingSession('newest', 'newest-revision'),
      'newest',
      'newest-revision',
      result(90),
    ),
  );
  assert.ok(loadAllShadowingSessions().length < 24);
  assert.equal(loadAllShadowingSessions().at(-1)?.lessonId, 'newest');
  assert.ok(
    new TextEncoder().encode(values.get('hibiki:v1:shadowing:history')!).byteLength <=
      MAX_SHADOWING_HISTORY_BYTES,
  );
  const corrupt = {
    ...createShadowingSession('bad', 'revision'),
    sections: { s1: { ...result(80), alignment: [null] } },
  };
  tab.set('hibiki:shadowing:v1:bad', JSON.stringify(corrupt));
  assert.deepEqual(loadShadowingSession('bad', 'revision').sections, {});
});
