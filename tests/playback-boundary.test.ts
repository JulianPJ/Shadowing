import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  adjustYoutubePauseCompensation,
  createBoundaryTimeEstimator,
  shadowingBoundaryLead,
} from '../src/lib/section-lookup';

function near(actual: number, expected: number) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
}

test('YouTube boundary time advances while iframe currentTime is briefly stale', () => {
  const estimate = createBoundaryTimeEstimator('youtube', 1);
  const end = 5;
  const lead = shadowingBoundaryLead('youtube', 1);

  assert.equal(estimate(4.8, 1_000) >= end - lead, false);
  assert.equal(estimate(4.8, 1_150) >= end - lead, true);
  near(estimate(4.8, 1_500), 5.15);
});

test('YouTube boundary time accepts fresh samples without moving backwards from short iframe lag', () => {
  const estimate = createBoundaryTimeEstimator('youtube', 1);

  near(estimate(10, 1_000), 10);
  near(estimate(10, 1_200), 10.2);
  near(estimate(10.18, 1_250), 10.25);
  near(estimate(10.18, 1_300), 10.3);
});

test('YouTube boundary time resets on seeks and scales interpolation with playback speed', () => {
  const fast = createBoundaryTimeEstimator('youtube', 1.25);
  near(fast(20, 1_000), 20);
  near(fast(20, 1_100), 20.125);
  near(fast(18, 1_110), 18);
  near(fast(22, 1_120), 22);

  const slow = createBoundaryTimeEstimator('youtube', 0.5);
  near(slow(30, 2_000), 30);
  near(slow(30, 2_200), 30.1);
});

test('non-YouTube boundary time always uses the provider-reported time', () => {
  const estimate = createBoundaryTimeEstimator('demo', 1);
  assert.equal(estimate(3, 1_000), 3);
  assert.equal(estimate(3, 2_000), 3);
  assert.equal(estimate(2.5, 3_000), 2.5);
});


test('YouTube boundary lead learns residual overshoot without affecting other media', () => {
  near(adjustYoutubePauseCompensation(0, 0.12, 1), 120);
  near(shadowingBoundaryLead('youtube', 1, 120), 0.175);
  near(shadowingBoundaryLead('youtube', 1.25, 120), 0.21875);
  near(adjustYoutubePauseCompensation(120, -0.04, 1), 80);
  near(shadowingBoundaryLead('demo', 1, 200), 0.025);
});

test('YouTube pause compensation is bounded and speed-normalized', () => {
  near(adjustYoutubePauseCompensation(0, 0.1, 0.5), 200);
  near(adjustYoutubePauseCompensation(200, 0.2, 1), 220);
  near(adjustYoutubePauseCompensation(80, -0.2, 1), 0);
  near(adjustYoutubePauseCompensation(50, Number.NaN, 1), 50);
});
