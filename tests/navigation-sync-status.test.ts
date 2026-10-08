import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authPath, safeReturnPath } from '../src/lib/auth/return-path';
import {
  aggregateSync,
  channelStatus,
  reportChannel,
  setChannelOwner,
  syncFailure,
} from '../src/lib/sync/channel-status';

test('auth returns preserve supported learning destinations and reject external or privileged routes', () => {
  const destination =
    '/practice/demo?section=segment-2&lookup=%E8%A9%B1%E3%81%9B%E3%81%BE%E3%81%99';
  assert.equal(safeReturnPath(destination), destination);
  assert.equal(safeReturnPath('/dictionary?view=decks'), '/dictionary?view=decks');
  assert.equal(
    authPath('/sign-in', destination),
    `/sign-in?returnTo=${encodeURIComponent(destination)}`,
  );
  for (const value of [
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '/%2fevil.example',
    '/api/auth/sign-out',
    '/sign-in?returnTo=//evil.example',
    '/practice/demo%0a',
    '/practice/../api/auth/sign-out',
    'javascript:alert(1)',
    '/account\n',
  ])
    assert.equal(safeReturnPath(value), '/account', value);
});

test('account sync is complete only when learner, review and knowledge have all succeeded', () => {
  setChannelOwner('learner');
  const date = '2026-10-07T10:00:00.000Z';
  reportChannel('learner', 'learner', { state: 'saved', lastSync: date });
  assert.equal(aggregateSync(channelStatus()).state, 'pending');
  reportChannel('learner', 'review', { state: 'saved', lastSync: date });
  reportChannel('learner', 'knowledge', { state: 'saved', lastSync: date });
  assert.equal(aggregateSync(channelStatus()).state, 'saved');
  reportChannel('learner', 'review', { state: 'saved', pending: 1 });
  assert.equal(aggregateSync(channelStatus()).state, 'pending');
  reportChannel('learner', 'review', { state: 'syncing', pending: 1 });
  assert.equal(aggregateSync(channelStatus()).state, 'syncing');
  reportChannel('learner', 'knowledge', { state: 'error', message: 'Word sync unavailable' });
  assert.equal(aggregateSync(channelStatus()).state, 'error');
  assert.equal(aggregateSync(channelStatus()).message, 'Word sync unavailable');
  setChannelOwner(null);
});

test('last complete sync uses the oldest channel confirmation and account changes discard old status', () => {
  setChannelOwner('one');
  for (const [channel, date] of [
    ['learner', '2026-10-07T12:00:00.000Z'],
    ['review', '2026-10-07T11:00:00.000Z'],
    ['knowledge', '2026-10-07T10:00:00.000Z'],
  ] as const)
    reportChannel('one', channel, { state: 'saved', lastSync: date });
  assert.equal(aggregateSync(channelStatus()).lastSync, '2026-10-07T10:00:00.000Z');
  setChannelOwner('two');
  reportChannel('one', 'learner', { state: 'error', pending: 2 });
  assert.equal(channelStatus().learner.state, 'idle');
  assert.equal(aggregateSync(channelStatus()).lastSync, null);
  setChannelOwner(null);
  assert.equal(aggregateSync(channelStatus()).state, 'local');
});

test('sync distinguishes server failures, disconnection, expired sessions and review conflicts', () => {
  assert.equal(syncFailure({ status: 503 }, true).state, 'error');
  assert.doesNotMatch(syncFailure({ status: 503 }, true).message, /reconnect/);
  assert.equal(syncFailure(new TypeError('Failed to fetch'), false).state, 'offline');
  assert.equal(syncFailure({ status: 401 }, true).state, 'auth');
  assert.equal(syncFailure({ status: 409, conflict: true }, true).state, 'conflict');
});
