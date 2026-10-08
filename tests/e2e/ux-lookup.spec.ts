import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import type { Lesson } from '../../src/lib/types';
import { connect } from '../helpers/retention-account';

test.use({ hasTouch: true });

const sentence = '日本語を話せます。';
const lesson = {
  ...demo,
  id: 'ux-lookup',
  title: 'Lookup regression lesson',
  segments: [{ ...demo.segments[0], japanese: sentence, translation: '' }],
} as Lesson;

async function open(context: BrowserContext, page: Page, initialLesson = lesson) {
  const remote = await connect(context);
  let records: unknown[] = [];
  await context.route('**/api/knowledge*', (route) => {
    if (route.request().method() === 'POST') records = route.request().postDataJSON().records;
    return route.fulfill({ json: { records, nextCursor: null, ok: true } });
  });
  await context.addInitScript((value) => {
    localStorage.setItem(`hibiki:v1:lesson:${value.id}`, JSON.stringify(value));
  }, initialLesson);
  await page.goto(`/practice/${initialLesson.id}`);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(localStorage.getItem('hibiki:v1:active-account') ?? 'null')),
    )
    .toBe('retention-free');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await expect(page.locator('#current-japanese .lookup-token').first()).toBeVisible();
  return remote;
}

async function close(page: Page) {
  await page.getByRole('button', { name: 'Close vocabulary lookup' }).click();
  await expect(page.getByRole('complementary', { name: 'Save vocabulary' })).toHaveCount(0);
}

test('full forms, sense choice and keyboard/touch phrase lookup retain exact context', async ({
  context,
  page,
}) => {
  const assets: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/furigana/')) assets.push(request.url());
  });
  await open(context, page);
  expect(assets).toEqual([]);
  const full = page.locator('#current-japanese [data-lookup="話せます"]');
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await full.click();
  await expect(panel.locator('.dictionary-save-heading')).toContainText('話せます');
  await expect(panel.locator('.dictionary-save-heading')).toContainText('話せる');
  expect(assets.length).toBeGreaterThan(0);
  await expect(panel.locator('[aria-pressed="true"]')).not.toHaveCount(0);
  await close(page);
  await expect(full).toBeFocused();

  await page.getByRole('button', { name: 'Furigana', exact: true }).click();
  await expect(full.locator('ruby')).not.toHaveCount(0);
  await expect(full).toHaveAttribute('data-lookup', '話せます');
  await full.click();
  await panel.getByRole('button', { name: 'Known', exact: true }).click();
  await close(page);
  await expect(full).toHaveAttribute('data-word-state', 'known');
  await expect(page.locator('#current-japanese [data-lookup][tabindex="0"]')).toHaveCount(1);

  const first = page.locator('#current-japanese [data-lookup="日本語"]');
  await first.focus();
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Enter');
  await expect(panel.locator('.dictionary-save-heading')).toContainText('日本語を話せます');
  await close(page);

  // Native selection, used by touch handles, exposes an explicit action and excludes ruby readings.
  await page.locator('#current-japanese .japanese-text').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.getByRole('button', { name: 'Look up selected phrase' }).tap();
  await expect(panel.locator('.dictionary-save-heading')).toContainText(sentence);
  await expect(panel.locator('.dictionary-save-heading')).not.toContainText('にほんご');
});

test('translation failure permits save only, default study enrolls chosen deck, and retry is duplicate safe', async ({
  context,
  page,
}) => {
  const remote = await open(context, page);
  remote.review.decks.push({ id: 'travel', name: 'Travel', createdAt: '', updatedAt: '' });
  await context.route('**/api/translate', (route) =>
    route.fulfill({ status: 503, json: { error: 'Translation unavailable' } }),
  );
  let saves = 0;
  await context.route('**/api/dictionary', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    saves++;
    // Keep the first request open so a second activation exercises the immediate submit lock.
    await new Promise((resolve) => setTimeout(resolve, 200));
    return route.fallback();
  });
  await page.locator('#current-japanese [data-lookup="話せます"]').click();
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(panel).toContainText('Sentence translation is unavailable');
  await expect(panel.getByLabel('Vocabulary meaning')).not.toHaveValue('');
  await expect(panel.getByLabel('Source sentence meaning')).toHaveValue('');
  await panel.getByLabel('Save vocabulary to deck').selectOption('travel');
  await panel.getByLabel('Vocabulary tag').fill('useful expression');
  const saveOnly = panel.getByRole('button', { name: 'Save only', exact: true });
  await saveOnly.evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(panel).toContainText('Saved for reference');
  await expect.poll(() => saves).toBe(1);
  expect(remote.entries).toHaveLength(1);
  expect(remote.entries[0]).toMatchObject({
    term: '話せる',
    sourceSentence: sentence,
    sourceSentenceTranslation: '',
  });
  expect(remote.review.cards).toHaveLength(0);
  expect(remote.entries[0].tags?.[0]?.name).toBe('useful expression');
  expect(remote.review.memberships).toContainEqual({
    deckId: 'travel',
    entryId: remote.entries[0].id,
  });

  await panel.getByRole('button', { name: 'Add saved word to study' }).click();
  await expect(panel.getByRole('button', { name: 'Saved and ready to study' })).toBeDisabled();
  await expect.poll(() => remote.review.cards.length).toBe(1);
  expect(saves).toBe(1);
  await expect(panel.getByRole('link', { name: 'Study this deck' })).toHaveAttribute(
    'href',
    '/review?deck=travel',
  );
  // Saving and enrollment do not infer a word knowledge state.
  const records = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('hibiki:v1:account:retention-free:knowledge:records') ?? '[]'),
  );
  expect(records).toEqual([]);
});

test('lookup failure offers retry and preserves a typed meaning', async ({ context, page }) => {
  await open(context, page);
  let unavailable = true;
  await context.route('**/lexicon/**', (route) =>
    unavailable ? route.fulfill({ status: 503, body: 'unavailable' }) : route.continue(),
  );
  await page.locator('#current-japanese [data-lookup="話せます"]').click();
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(panel.getByRole('button', { name: 'Retry dictionary lookup' })).toBeVisible();
  await panel.getByLabel('Vocabulary meaning').fill('my contextual meaning');
  unavailable = false;
  await panel.getByRole('button', { name: 'Retry dictionary lookup' }).click();
  await expect(panel.locator('.lexicon-match')).not.toHaveCount(0);
  await expect(panel.getByLabel('Vocabulary meaning')).toHaveValue('my contextual meaning');
  await expect(panel.getByRole('button', { name: 'Save and study', exact: true })).toBeEnabled();
});

test('tag failure preserves one saved word and permits save-only recovery without enrolling it', async ({
  context,
  page,
}) => {
  const remote = await open(context, page);
  let fail = true;
  await context.route('**/api/tags', (route) =>
    route.request().method() === 'POST' && fail
      ? route.fulfill({ status: 503, json: { error: 'Tag service unavailable' } })
      : route.fallback(),
  );
  await page.locator('#current-japanese [data-lookup="話せます"]').click();
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await panel.getByLabel('Vocabulary tag').fill('practice');
  await panel.getByRole('button', { name: 'Save and study', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('The word is saved');
  expect(remote.entries).toHaveLength(1);
  expect(remote.review.cards).toHaveLength(0);
  fail = false;
  await panel.getByRole('button', { name: 'Save only', exact: true }).click();
  await expect(panel).toContainText('Saved for reference');
  expect(remote.entries).toHaveLength(1);
  expect(remote.review.cards).toHaveLength(0);
  expect(remote.entries[0].tags?.[0]?.name).toBe('practice');
});

test('rejected deck enrollment clears the ready claim and allows enrollment in a surviving deck', async ({
  context,
  page,
}) => {
  const remote = await open(context, page);
  remote.review.decks.push({ id: 'deleted', name: 'Temporary', createdAt: '', updatedAt: '' });
  await context.route('**/api/review', (route) => {
    if (
      route.request().method() === 'POST' &&
      route.request().postDataJSON().deckId === 'deleted'
    ) {
      remote.review.decks = remote.review.decks.filter((deck) => deck.id !== 'deleted');
      return route.fulfill({
        status: 409,
        json: { code: 'review-conflict', error: 'The deck was removed.' },
      });
    }
    return route.fallback();
  });
  await page.locator('#current-japanese [data-lookup="話せます"]').click();
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await panel.getByLabel('Save vocabulary to deck').selectOption('deleted');
  await panel.getByRole('button', { name: 'Save and study', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('The word is saved');
  await expect(panel.getByRole('link', { name: 'Study this deck' })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Saved and ready to study' })).toHaveCount(0);
  await panel.getByLabel('Save vocabulary to deck').selectOption('inbox');
  await panel.getByRole('button', { name: 'Add saved word to study' }).click();
  await expect.poll(() => remote.review.cards.length).toBe(1);
  await expect(panel.getByRole('link', { name: 'Study this deck' })).toHaveAttribute(
    'href',
    '/review?deck=inbox',
  );
  expect(remote.entries).toHaveLength(1);
});

test('a chosen lexical sense and retry preserve one contextual saved word', async ({
  context,
  page,
}) => {
  const source = '声が上がりました。';
  const remote = await open(context, page, {
    ...lesson,
    segments: [{ ...lesson.segments[0], japanese: source }],
  });
  let fail = true;
  await context.route('**/api/dictionary', (route) => {
    if (route.request().method() === 'POST' && fail)
      return route.fulfill({ status: 503, json: { error: 'Saving is temporarily unavailable.' } });
    return route.fallback();
  });
  // Activate the cold suffix target directly: lookup must expand it to the predicate.
  await page.locator('#current-japanese [data-lookup="ま"]').focus();
  await page
    .locator('#current-japanese [data-lookup="ま"]')
    .evaluate((element: HTMLElement) => element.click());
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(panel.locator('.dictionary-save-heading')).toContainText('上がりました');
  const chosen = panel.locator('.lexicon-match').first().locator('li').nth(1);
  await expect(chosen.getByRole('button', { name: 'Use sense 2' })).toBeVisible();
  const meaning = (await chosen.locator('p').textContent())!;
  await chosen.getByRole('button', { name: 'Use sense 2' }).click();
  await expect(chosen.getByRole('button', { name: 'Selected', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(panel.getByLabel('Vocabulary meaning')).toHaveValue(meaning);
  await panel.getByLabel('Source sentence meaning').fill('The voice rose.');
  await panel.getByRole('button', { name: 'Save only', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('Saving is temporarily unavailable');
  await expect(panel.getByLabel('Vocabulary meaning')).toHaveValue(meaning);
  fail = false;
  await panel.getByRole('button', { name: 'Save only', exact: true }).click();
  await expect(panel).toContainText('Saved for reference');
  expect(remote.entries).toHaveLength(1);
  expect(remote.entries[0]).toMatchObject({
    term: '上がる',
    translation: meaning,
    sourceSentence: source,
    sourceSentenceTranslation: 'The voice rose.',
  });
  await close(page);
  await expect(page.locator('#current-japanese [data-lookup="上がりました"]')).toBeFocused();
});

test('a cold pending lookup is cancelled when the learner changes section', async ({
  context,
  page,
}) => {
  await context.addInitScript(() => {
    const OriginalWorker = window.Worker;
    window.Worker = class extends OriginalWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', () => {
          (window as typeof window & { lookupWorkerFinished?: boolean }).lookupWorkerFinished =
            true;
        });
      }
    };
  });
  await open(context, page, { ...lesson, segments: [...lesson.segments, demo.segments[1]] });
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  await context.route('**/furigana/v1/worker.js', async (route) => {
    await hold;
    await route.continue();
  });
  await page
    .locator('#current-japanese [data-lookup="話せます"]')
    .evaluate((element: HTMLElement) => element.click());
  await expect(page.getByText('Finding the full word…', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[1].japanese);
  release();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { lookupWorkerFinished?: boolean }).lookupWorkerFinished,
      ),
    )
    .toBe(true);
  await expect(page.getByRole('complementary', { name: 'Save vocabulary' })).toHaveCount(0);
  await expect(page.getByText('Finding the full word…', { exact: true })).toHaveCount(0);
});
