import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBoundaryTimeEstimator,
  shadowingBoundaryLead,
} from '../src/lib/section-lookup';

test('YouTube boundary time advances while iframe currentTime is briefly stale', () => {
  const estimate = createBoundaryTimeEstimator('youtube', 1);
  const end = 5;
  const lead = shadowingBoundaryLead('youtube', 1);

  assert.equal(estimate(4.8, 1_000) >= end - lead, false);
  assert.equal(estimate(4.8, 1_150) >= end - lead, true);
  assert.equal(estimate(4.8, 1_500), 5.15);
});

test('YouTube boundary time accepts fresh samples without moving backwards from short iframe lag', () => {
  const estimate = createBoundaryTimeEstimator('youtube', 1);

  assert.equal(estimate(10, 1_000), 10);
  assert.equal(estimate(10, 1_200), 10.2);
  assert.equal(estimate(10.18, 1_250), 10.25);
  assert.equal(estimate(10.18, 1_300), 10.3);
});

test('YouTube boundary time resets on seeks and scales interpolation with playback speed', () => {
  const fast = createBoundaryTimeEstimator('youtube', 1.25);
  assert.equal(fast(20, 1_000), 20);
  assert.equal(fast(20, 1_100), 20.125);
  assert.equal(fast(18, 1_110), 18);
  assert.equal(fast(22, 1_120), 22);

  const slow = createBoundaryTimeEstimator('youtube', 0.5);
  assert.equal(slow(30, 2_000), 30);
  assert.equal(slow(30, 2_200), 30.1);
});

test('non-YouTube boundary time always uses the provider-reported time', () => {
  const estimate = createBoundaryTimeEstimator('demo', 1);
  assert.equal(estimate(3, 1_000), 3);
  assert.equal(estimate(3, 2_000), 3);
  assert.equal(estimate(2.5, 3_000), 2.5);
});
