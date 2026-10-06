import { test, expect, type BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import type { DictionaryEntry } from '../../src/lib/dictionary/types';
import type { ReviewSnapshot, ReviewOperation } from '../../src/lib/review/types';
import { emptyReview, applyLocalReview } from '../../src/lib/review/local';
import { dictionarySource } from '../../src/lib/dictionary/source';
import type { Lesson } from '../../src/lib/types';
type Remote = {
  entries: DictionaryEntry[];
  review: ReviewSnapshot;
  offline: boolean;
  writes: ReviewOperation[];
};
async function connect(context: BrowserContext, plan: AccountUser['plan'] = 'free') {
  const user: AccountUser = {
    id: 'retention-' + plan,
    email: plan + '@example.com',
    name: 'Learner',
    emailVerified: true,
    plan,
  };
  await context.addInitScript(
    (id) =>
      localStorage.setItem(
        `hibiki:v1:account:${id}:sync:import-decision`,
        JSON.stringify('declined'),
      ),
    user.id,
  );
  const remote: Remote = {
    entries: [],
    review: {
      ...emptyReview(),
      decks: [{ id: 'inbox', name: 'Inbox', createdAt: '', updatedAt: '' }],
    },
    offline: false,
    writes: [],
  };
  await context.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user, googleEnabled: false, emailEnabled: false } }),
  );
  await context.route('**/api/sync/bootstrap*', (route) =>
    route.fulfill({ json: { data: emptySync(), nextCursor: null } }),
  );
  await context.route('**/api/sync/push', (route) => route.fulfill({ json: { ok: true } }));
  await context.route('**/api/translate', (route) =>
    route.fulfill({ json: { translation: 'morning' } }),
  );
  await context.route('**/api/review', (route) => {
    if (remote.offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (route.request().method() === 'POST') {
      const op = route.request().postDataJSON() as ReviewOperation;
      remote.writes.push(op);
      remote.review = applyLocalReview(remote.review, op);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: remote.review });
  });
  await context.route('**/api/dictionary', (route) => {
    if (remote.offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (route.request().method() === 'GET')
      return route.fulfill({ json: { entries: remote.entries } });
    const body = route.request().postDataJSON();
    if (body.action === 'delete') {
      remote.entries = remote.entries.filter((e) => e.id !== body.id);
      remote.review.cards = remote.review.cards.filter((c) => c.entryId !== body.id);
      return route.fulfill({ json: { ok: true } });
    }
    const now = new Date().toISOString();
    const entry: DictionaryEntry = {
      ...body.entry,
      id: crypto.randomUUID(),
      normalizedTerm: body.entry.term,
      createdAt: now,
      updatedAt: now,
    };
    remote.entries.unshift(entry);
    remote.review.memberships.push({ deckId: 'inbox', entryId: entry.id });
    return route.fulfill({ json: { entry } });
  });
  return remote;
}
async function seed(remote: Remote, count: number) {
  for (let i = 0; i < count; i++) {
    const now = new Date(Date.now() - 60000).toISOString(),
      segment = demo.segments[i + 1];
    const entry: DictionaryEntry = {
      schemaVersion: 1,
      id: 'word-' + i,
      term: ['朝', '空', '静か', '散歩'][i],
      reading: null,
      normalizedTerm: 'term-' + i,
      translation: 'Meaning ' + i,
      sourceSentence: segment.japanese,
      sourceSentenceTranslation: segment.translation,
      source: await dictionarySource(demo as Lesson, segment),
      createdAt: now,
      updatedAt: now,
    };
    remote.entries.push(entry);
    remote.review = applyLocalReview(remote.review, {
      action: 'enroll',
      entryIds: [entry.id],
      deckId: 'inbox',
      enrolledAt: now,
    });
  }
}
for (const plan of ['free', 'pro'] as const)
  test(`${plan}: save during practice, explicit enrollment, reveal, context replay and grade`, async ({
    page,
    context,
  }) => {
    const remote = await connect(context, plan);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    if (plan === 'free') await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/practice/demo');
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
    await page.locator('#current-japanese .lookup-token').first().click();
    await expect(page.getByLabel('Vocabulary meaning')).toHaveValue('morning');
    await page.getByRole('button', { name: 'Save to dictionary', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
    expect(remote.review.cards).toHaveLength(0);
    await page.getByRole('button', { name: 'Add to review', exact: true }).click();
    await expect.poll(() => remote.review.cards.length).toBe(1);
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: '1 due · ~1 min' })).toBeVisible();
    await page.getByRole('button', { name: 'Start review' }).click();
    await expect(page.getByText('morning', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Reveal answer' }).click();
    await expect(page.getByText('morning', { exact: true })).toBeVisible();
    await page.screenshot({ path: `artifacts/review-${plan}.png`, fullPage: true });
    const popupPromise = page.waitForEvent('popup');
    await page.getByRole('link', { name: 'Play in context', exact: true }).click();
    const popup = await popupPromise;
    await expect(popup.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);
    await popup.close();
    await page.getByRole('button', { name: 'Good', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
    await expect.poll(() => remote.review.cards[0].repetitions).toBe(1);
    await page.reload();
    await expect(page.getByRole('heading', { name: '0 due · ~1 min' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
test('all four grades advance the session and persist deterministic state across devices', async ({
  browser,
}) => {
  const context = await browser.newContext(),
    remote = await connect(context);
  await seed(remote, 4);
  const page = await context.newPage();
  try {
    await page.goto('/review');
    await expect(page.getByRole('heading', { name: '4 due · ~1 min' })).toBeVisible();
    await page.getByRole('button', { name: 'Start review' }).click();
    for (const grade of ['Again', 'Hard', 'Good', 'Easy']) {
      await page.getByRole('button', { name: 'Reveal answer' }).click();
      await page.getByRole('button', { name: grade, exact: true }).click();
    }
    await expect(page.getByRole('heading', { name: 'Review complete' })).toBeVisible();
    await expect.poll(() => remote.review.cards.map((c) => c.revision)).toEqual([1, 1, 1, 1]);
    expect(remote.review.cards.map((c) => c.intervalDays)).toEqual([0, 1, 1, 4]);
    const second = await browser.newContext();
    await connect(second); // Replace mock routes with the first device's authoritative state.
    await second.route('**/api/review', (route) => route.fulfill({ json: remote.review }));
    await second.route('**/api/dictionary', (route) =>
      route.fulfill({ json: { entries: remote.entries } }),
    );
    const other = await second.newPage();
    await other.goto('/review');
    await expect(other.getByRole('heading', { name: '0 due · ~1 min' })).toBeVisible();
    await second.close();
  } finally {
    await context.close();
  }
});
test('deck filtering, membership removal, bulk enrollment and context CSV export', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 2);
  remote.review.cards = [];
  await page.goto('/dictionary');
  await expect(page.getByRole('heading', { name: '朝', exact: true })).toBeVisible();
  await page.getByLabel('New deck').fill('Travel');
  await page.getByRole('button', { name: 'Create deck' }).click();
  await expect.poll(() => remote.review.decks.length).toBe(2);
  const first = page
    .locator('.dictionary-entry')
    .filter({ has: page.getByRole('heading', { name: '朝', exact: true }) });
  await first.getByLabel('Travel', { exact: true }).check();
  await page.getByLabel('Filter by deck').selectOption({ label: 'Travel' });
  await expect(page.locator('.dictionary-entry')).toHaveCount(1);
  await page.getByLabel('Select 朝', { exact: true }).check();
  await page.getByRole('button', { name: 'Add selected to review', exact: true }).click();
  await expect.poll(() => remote.review.cards.length).toBe(1);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export selected CSV' }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, 'utf8');
  expect(csv).toContain('"朝"');
  expect(csv).toContain('Meaning 0');
  expect(csv).toContain(demo.segments[1].japanese);
  expect(csv).toContain('Travel');
  await page.getByRole('button', { name: 'Remove selected from deck' }).click();
  await expect(page.locator('.dictionary-entry')).toHaveCount(0);
  expect(remote.entries).toHaveLength(2);
});
test('offline grading survives reload and retries without duplicating reviews', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await expect(page.getByRole('heading', { name: '1 due · ~1 min' })).toBeVisible();
  await page.getByRole('button', { name: 'Start review' }).click();
  remote.offline = true;
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await page.getByRole('button', { name: 'Easy', exact: true }).click();
  await expect(page.getByText(/changes saved on this device/)).toBeVisible();
  expect(remote.review.cards[0].revision).toBe(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: '0 due · ~1 min' })).toBeVisible();
  remote.offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => remote.review.cards[0].revision).toBe(1);
  await page.reload();
  await expect(page.getByRole('heading', { name: '0 due · ~1 min' })).toBeVisible();
  expect(remote.writes.filter((w) => w.action === 'grade')).toHaveLength(1);
});
test('completion recap explicitly hands selected saved lesson words to review', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  remote.review.cards = [];
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByTestId('transcript-13').click();
  await page.getByRole('button', { name: /Finish practice/ }).click();
  const recap = page.getByRole('region', { name: 'Lesson recap' });
  await expect(recap).toContainText('14 sections completed · 1 saved words');
  expect(remote.review.cards).toHaveLength(0);
  await recap.getByRole('checkbox').check();
  await recap.getByRole('button', { name: 'Add selected words to review' }).click();
  await expect.poll(() => remote.review.cards.length).toBe(1);
  await expect(recap).toContainText('In review');
});

test('review source links refuse a changed transcript revision', async ({ page, context }) => {
  const remote = await connect(context);
  await seed(remote, 1);
  remote.entries[0].source.transcriptKey = 'a'.repeat(64);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review' }).click();
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  const promise = page.waitForEvent('popup');
  await page.getByRole('link', { name: 'Play in context', exact: true }).click();
  const popup = await promise;
  await expect(
    popup.getByRole('heading', { name: 'This saved context has changed.' }),
  ).toBeVisible();
  await expect(popup.locator('video')).toHaveCount(0);
  await popup.close();
  await expect(page.getByRole('button', { name: 'Good', exact: true })).toBeVisible();
});

test('an account-cookie mismatch preserves the old account review outbox', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review' }).click();
  await context.route('**/api/review', (route) =>
    route.fulfill({ status: 409, json: { error: 'Account changed. Refresh your session.' } }),
  );
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(page.getByText(/changes saved on this device/)).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:review:pending') || '[]',
          ).length,
      ),
    )
    .toBe(1);
  expect(remote.review.cards[0].revision).toBe(0);
});

test('a competing device grade restores its schedule and reports a review conflict', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 1);
  await page.goto('/review');
  await page.getByRole('button', { name: 'Start review' }).click();
  remote.review = applyLocalReview(remote.review, {
    action: 'grade',
    entryId: 'word-0',
    revision: 0,
    grade: 'easy',
    reviewedAt: new Date().toISOString(),
    operationId: 'other-device',
  });
  await context.route('**/api/review', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 409,
          json: { code: 'review-conflict', error: 'This word changed on another device.' },
        })
      : route.fulfill({ json: remote.review }),
  );
  await page.getByRole('button', { name: 'Reveal answer' }).click();
  await page.getByRole('button', { name: 'Good', exact: true }).click();
  await expect(
    page.getByText('A review changed on another device. Its latest schedule was restored.'),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:review:pending') || '[]',
          ).length,
      ),
    )
    .toBe(0);
  expect(
    await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem('hibiki:v1:account:retention-free:review:data')!).cards[0]
          .intervalDays,
    ),
  ).toBe(4);
});
