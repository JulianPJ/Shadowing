import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authPath, safeReturnPath } from '../src/lib/auth/return-path';
import {
  channelStatus,
  reportChannel,
  sessionExpired,
  setChannelOwner,
  syncFailure,
} from '../src/lib/sync/channel-status';

test('auth returns preserve supported learning destinations and reject external or privileged routes', () => {
  const destination =
    '/practice/demo?section=segment-2&lookup=%E8%A9%B1%E3%81%9B%E3%81%BE%E3%81%99';
  assert.equal(safeReturnPath(destination), destination);
  assert.equal(safeReturnPath('/dictionary?view=decks'), '/dictionary?view=decks');
  assert.equal(safeReturnPath('/profile'), '/profile');
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

test('sync stays silent unless a signed-in account must sign in again', () => {
  setChannelOwner('learner');
  for (const state of ['syncing', 'pending', 'error', 'offline', 'conflict'] as const) {
    reportChannel('learner', 'review', { state });
    assert.equal(sessionExpired(channelStatus()), false, state);
  }
  reportChannel('learner', 'knowledge', syncFailure({ status: 401 }, true));
  assert.equal(sessionExpired(channelStatus()), true);
  reportChannel('learner', 'knowledge', { state: 'saved', message: '' });
  assert.equal(sessionExpired(channelStatus()), false);
  setChannelOwner(null);
});

test('account changes discard the previous account status', () => {
  setChannelOwner('one');
  reportChannel('one', 'learner', { state: 'auth' });
  assert.equal(sessionExpired(channelStatus()), true);
  setChannelOwner('two');
  reportChannel('one', 'learner', { state: 'auth' });
  assert.equal(channelStatus().learner.state, 'idle');
  assert.equal(sessionExpired(channelStatus()), false);
  setChannelOwner(null);
  reportChannel('two', 'learner', { state: 'auth' });
  assert.equal(sessionExpired(channelStatus()), false);
});

test('sync distinguishes server failures, disconnection, expired sessions and review conflicts', () => {
  assert.equal(syncFailure({ status: 503 }, true).state, 'error');
  assert.doesNotMatch(syncFailure({ status: 503 }, true).message, /reconnect/);
  assert.equal(syncFailure(new TypeError('Failed to fetch'), false).state, 'offline');
  assert.equal(syncFailure({ status: 401 }, true).state, 'auth');
  assert.equal(syncFailure({ status: 409, conflict: true }, true).state, 'conflict');
});
