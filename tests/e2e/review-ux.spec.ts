import { test, expect } from '@playwright/test';
import { connect, seed } from '../helpers/retention-account';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { dictionarySource } from '../../src/lib/dictionary/source';
import type { Lesson } from '../../src/lib/types';

test('all 25 due cards can be finished; optional limits keep the remaining backlog visible', async ({
  page,
  context,
}) => {
  test.setTimeout(120000);
  const remote = await connect(context);
  await seed(remote, 25);
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '25 due now' })).toBeVisible();
  await page.getByText('Daily limits', { exact: true }).click();
  await page.getByLabel('Daily new card limit').selectOption('20');
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  for (let i = 0; i < 20; i++) {
    await page.getByRole('button', { name: /Reveal answer/ }).waitFor();
    await page.locator('.review-card h2').focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /^Easy/ })).toBeVisible();
    await page.keyboard.press('4');
  }
  await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
  await expect(
    page.getByText('5 cards remain due beyond your daily limits. Today’s backlog is still saved.'),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
  await page.getByRole('button', { name: 'Study all due today', exact: true }).click();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: /Reveal answer/ }).waitFor();
    await page.locator('.review-card h2').focus();
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: /^Easy/ })).toBeVisible();
    await page.keyboard.press('4');
  }
  await expect(page.getByRole('heading', { name: 'Today’s due queue is complete' })).toBeVisible();
  await expect.poll(() => remote.review.cards.every((card) => card.revision === 1)).toBe(true);
  expect(remote.writes.filter((op) => op.action === 'grade')).toHaveLength(25);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Again returns automatically with actual intervals; later-today study accelerates only learning', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.clock.install({ time: new Date() });
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await page.locator('.review-card h2').focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: /^Again · 1m/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Good · 10m/ })).toBeVisible();
  await page.keyboard.press('1');
  await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
  await expect.poll(() => remote.review.cards[0].revision).toBe(1);
  expect(
    Date.parse(remote.review.cards[0].dueAt) - Date.parse(remote.review.cards[0].lastReviewedAt!),
  ).toBe(60000);
  await page.clock.fastForward(61000);
  await expect(page.getByRole('button', { name: /Reveal answer/ })).toBeVisible();
  await page.getByRole('button', { name: /Reveal answer/ }).click();
  await page.getByRole('button', { name: /^Good · 10m/ }).click();
  await expect(page.getByRole('heading', { name: 'Caught up for now' })).toBeVisible();
  await page.getByRole('button', { name: 'Study remaining today now', exact: true }).click();
  await page.getByRole('button', { name: /Reveal answer/ }).click();
  await page.getByRole('button', { name: /^Good · 1d/ }).click();
  await expect(page.getByRole('heading', { name: 'Today’s due queue is complete' })).toBeVisible();
  await expect.poll(() => remote.review.cards[0].revision).toBe(3);
  expect(remote.review.cards[0].status).toBe('review');
  expect(remote.review.cards[0].intervalDays).toBe(1);
});

test('offline undo restores the card and a corrected grade syncs in revision order after reload', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await page.getByText('Daily limits', { exact: true }).click();
  await page.getByLabel('Daily new card limit').selectOption('1');
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  remote.offline = true;
  await page.getByRole('button', { name: /Reveal answer/ }).click();
  await page.getByRole('button', { name: /^Easy/ }).click();
  await page.getByRole('button', { name: 'Undo last rating', exact: true }).click();
  await expect(page.getByRole('button', { name: /Reveal answer/ })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /Reveal answer/ }).click();
  await page.getByRole('button', { name: /^Good/ }).click();
  remote.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => remote.review.cards[0].revision).toBe(3);
  expect(remote.review.cards[0].status).toBe('learning');
  expect(remote.writes.map((op) => op.action)).toEqual(['grade', 'undo', 'grade']);
  const history = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hibiki:v1:account:retention-free:review:history') || '[]'),
  );
  expect(history).toHaveLength(1);
  expect(history[0].grade).toBe('good');
});

test('reading and bounded inline context preserve the answer and session', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  remote.entries[0].reading = 'あさ';
  remote.entries[0].source = await dictionarySource(demo as Lesson, demo.segments[1]);
  remote.entries[0].sourceSentence = demo.segments[1].japanese;
  await page.goto('/review?deck=inbox');
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByText('あさ', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Show reading', exact: true }).click();
  await expect(page.getByText('あさ', { exact: true })).toBeVisible();
  expect(remote.writes).toHaveLength(0);
  await page.getByRole('button', { name: /Reveal answer/ }).click();
  await page.getByRole('button', { name: 'Play this section', exact: true }).click();
  await page.getByRole('button', { name: 'Play section', exact: true }).click();
  const video = page.locator('.review-context video');
  const end = remote.entries[0].source.end;
  await expect.poll(() => video.evaluate((node) => !(node as HTMLVideoElement).paused)).toBe(true);
  await video.evaluate((node, start) => {
    (node as HTMLVideoElement).currentTime = start - 2;
  }, remote.entries[0].source.start);
  await expect
    .poll(() => video.evaluate((node) => (node as HTMLVideoElement).currentTime))
    .toBeGreaterThanOrEqual(remote.entries[0].source.start);
  await video.evaluate((node, finish) => {
    (node as HTMLVideoElement).currentTime = finish - 0.15;
  }, end);
  await expect.poll(() => video.evaluate((node) => (node as HTMLVideoElement).paused)).toBe(true);
  expect(await video.evaluate((node) => (node as HTMLVideoElement).currentTime)).toBeLessThan(
    end + 0.4,
  );
  await page.getByRole('button', { name: 'Minimise context', exact: true }).click();
  await expect(page.locator('.review-context video')).toHaveCount(0);
  await expect(page.getByText('Meaning 0', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Good/ })).toBeVisible();
});

test('cold material hydration shows loading and input-focused shortcuts leave study alone', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('**/api/dictionary?ids=*', async (route) => {
    await ready;
    await route.fallback();
  });
  await page.goto('/review');
  await page.getByText('Daily limits', { exact: true }).click();
  await page.getByLabel('Daily new card limit').focus();
  await page.keyboard.press('Space');
  expect(remote.writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Loading this word…' })).toBeVisible();
  await expect(page.getByText('This word’s material is unavailable here yet.')).toHaveCount(0);
  release();
  await expect(page.getByRole('button', { name: /Reveal answer/ })).toBeVisible();
});

test('a new account opens its own schedule while the previous account fetch is still pending', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  let otherAccount = false;
  await context.route('**/api/account/me', (route) =>
    route.fulfill({
      json: {
        user: {
          id: otherAccount ? 'review-other' : 'retention-free',
          email: 'learner@example.com',
          name: 'Learner',
          emailVerified: true,
          plan: 'free',
        },
        googleEnabled: false,
        emailEnabled: false,
      },
    }),
  );
  let release!: () => void;
  let held!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    held = resolve;
  });
  let first = true;
  await context.route('**/api/review', async (route) => {
    const owner = route.request().headers()['x-hibiki-account'];
    if (owner === 'retention-free' && first) {
      first = false;
      held();
      await blocked;
    }
    await route.fulfill({ json: remote.review });
  });
  await context.route('**/api/dictionary*', (route) =>
    route.fulfill({
      json: {
        entries: remote.entries.map((entry) => ({
          ...entry,
          term: otherAccount ? '別の単語' : entry.term,
        })),
      },
    }),
  );
  await page.goto('/review');
  await started;
  await page.evaluate(() =>
    localStorage.setItem('hibiki:v1:account:review-other:sync:import-decision', '"declined"'),
  );
  otherAccount = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading', { name: '1 due now' })).toBeVisible();
  await page.getByRole('button', { name: 'Start review', exact: true }).click();
  await expect(page.locator('.review-card h2')).toHaveText('別の単語');
  release();
  await expect(page.locator('.review-card h2')).toHaveText('別の単語');
});

test('a second device applies shared daily counts from accepted grades', async ({ browser }) => {
  const first = await browser.newContext();
  const remote = await connect(first);
  await seed(remote, 2);
  const learner = await first.newPage();
  await learner.goto('/review');
  await learner.getByText('Daily limits', { exact: true }).click();
  await learner.getByLabel('Daily new card limit').selectOption('1');
  await learner.getByRole('button', { name: 'Start review', exact: true }).click();
  await learner.getByRole('button', { name: /Reveal answer/ }).click();
  await learner.getByRole('button', { name: /^Easy/ }).click();
  await expect.poll(() => remote.review.history?.length).toBe(1);
  const second = await browser.newContext();
  await connect(second);
  await second.addInitScript(() =>
    localStorage.setItem(
      'hibiki:v1:account:retention-free:review:study-settings',
      JSON.stringify({ defaults: { new: 1, review: null }, decks: {}, extensions: {} }),
    ),
  );
  await second.route('**/api/review', (route) => route.fulfill({ json: remote.review }));
  await second.route('**/api/dictionary*', (route) =>
    route.fulfill({ json: { entries: remote.entries } }),
  );
  const other = await second.newPage();
  try {
    await other.goto('/review');
    await expect(other.getByRole('heading', { name: '0 due now' })).toBeVisible();
    await expect(other.getByRole('button', { name: 'Start review', exact: true })).toBeDisabled();
    await expect(other.getByText(/1 more card is due beyond your daily limits/)).toBeVisible();
  } finally {
    await first.close();
    await second.close();
  }
});
