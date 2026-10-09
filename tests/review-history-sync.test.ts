import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMemoryStorage } from './helpers/memory-storage';
import { readStorage, setStorageAccount, writeStorage } from '../src/lib/storage/browser';
import { reconcileReviewHistory, reviewHistory, type ReviewEvent } from '../src/lib/review/history';
import { newReview } from '../src/lib/review-scheduler';
import { limitStudyQueue } from '../src/lib/review/study-settings';
import { emptyReview } from '../src/lib/review/local';

test('a second device uses accepted ratings for daily limits and removes undone ratings while preserving older local history', () => {
  const date = new Date().toISOString();
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const older: ReviewEvent = {
    operationId: 'old',
    entryId: 'earlier',
    grade: 'good',
    reviewedAt: new Date(Date.now() - 8 * 86400000).toISOString(),
    status: 'review',
  };
  const accepted: ReviewEvent = {
    operationId: 'accepted',
    entryId: 'studied',
    grade: 'easy',
    reviewedAt: date,
    status: 'new',
  };
  const deviceA = new Map<string, string>(),
    deviceB = new Map<string, string>();
  for (const storage of [deviceA, deviceB]) {
    installMemoryStorage(storage);
    setStorageAccount('learner');
    writeStorage('review:history', [older]);
    reconcileReviewHistory({ ...emptyReview(), history: [accepted], historySince: since }, []);
    assert.deepEqual(reviewHistory(), [older, accepted]);
    const cards = [newReview('studied', date), newReview('remaining', date)];
    assert.equal(
      limitStudyQueue(cards, reviewHistory(), date, { new: 1, review: null }).cards.length,
      0,
    );
    reconcileReviewHistory({ ...emptyReview(), history: [], historySince: since }, []);
    assert.deepEqual(reviewHistory(), [older]);
    assert.equal(
      limitStudyQueue(cards, reviewHistory(), date, { new: 1, review: null }).cards.length,
      1,
    );
  }
  installMemoryStorage(deviceA);
  setStorageAccount('other');
  assert.deepEqual(reviewHistory(), []);
  setStorageAccount(null);
});

test('pending ratings overlay authoritative snapshots and pending undo removes their effective count', () => {
  installMemoryStorage();
  setStorageAccount('learner');
  const at = new Date().toISOString();
  const before = newReview('word', at);
  const grade = {
    action: 'grade' as const,
    operationId: 'pending',
    entryId: 'word',
    revision: 0,
    grade: 'good' as const,
    reviewedAt: at,
  };
  const remote = { ...emptyReview(), history: [], historySince: at };
  reconcileReviewHistory(remote, [grade]);
  assert.equal(reviewHistory()[0].status, 'new');
  reconcileReviewHistory(remote, [
    grade,
    {
      action: 'undo',
      operationId: 'undo',
      entryId: 'word',
      revision: 1,
      targetOperationId: 'pending',
      previous: before,
      undoneAt: at,
    },
  ]);
  assert.deepEqual(reviewHistory(), []);
  assert.deepEqual(readStorage('review:authoritative-history-ids', []), []);
  setStorageAccount(null);
});
