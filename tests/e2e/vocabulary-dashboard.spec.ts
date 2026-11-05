import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { connect, seed } from '../helpers/retention-account';
import { newReview } from '../../src/lib/review-scheduler';
import { mkdir } from 'node:fs/promises';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

for (const width of [1440, 390])
  test(`imported Anki words are text-only on the dashboard at ${width}px`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const remote = await connect(context);
    const collection = sha256('Japanese');
    const now = new Date().toISOString();
    const id = sha256('猫 import');
    // Words imported from Anki before the importer was removed are stored like this.
    remote.entries.push({
      schemaVersion: 1,
      id,
      normalizedTerm: '猫',
      term: '猫',
      reading: 'ねこ',
      translation: 'cat',
      sourceSentence: '猫です。',
      sourceSentenceTranslation: 'A cat.',
      createdAt: now,
      updatedAt: now,
      source: {
        kind: 'anki',
        collection: 'Japanese',
        contentKey: id,
        lessonId: '',
        segmentId: id,
        lessonTitle: 'Japanese',
        lessonAuthor: 'Anki',
        mediaType: 'local',
        mediaId: null,
        mediaUrl: null,
        mediaContentKey: null,
        transcriptKey: '',
        start: 0,
        end: 0,
      },
    });
    remote.review.cards.push(newReview(id, now));
    await page.route('**/api/vocabulary/collections', (route) =>
      route.fulfill({ json: { collections: [{ id: collection, name: 'Japanese' }] } }),
    );
    await page.route('**/api/knowledge*', (route) =>
      route.fulfill({
        json: {
          records: remote.entries.map((e) => ({
            lemma: e.term,
            reading: e.reading,
            state: 'learning',
            updatedAt: e.updatedAt,
          })),
          nextCursor: null,
          syncedThrough: new Date().toISOString(),
        },
      }),
    );
    await page.goto('/vocabulary');
    await expect(page.locator('#explore-words')).toContainText('猫');
    await page
      .locator('#explore-words')
      .getByRole('button', { name: /猫\s*ねこ/ })
      .click();
    await expect(page.locator('.word-details')).toContainText('Anki import');
    await expect(
      page.locator('.word-details').getByRole('link', { name: 'Open original lesson' }),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Explore 猫', exact: true }).click();
    await expect(page.getByLabel('Kanji in loaded words')).toHaveValue('猫');
    await page.locator('#explore-words').getByRole('checkbox', { name: 'Select 猫' }).check();
    await page.getByRole('button', { name: 'Practise selected words' }).click();
    await page.getByRole('button', { name: 'Reveal meaning & sentence' }).click();
    await expect(page.locator('.targeted-practice')).toContainText('猫です。');
    expect(remote.writes).toHaveLength(0);
    await page.getByRole('button', { name: 'End practice', exact: true }).click();
    await page.getByLabel('Kanji in loaded words').selectOption('');
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.evaluate(() => window.scrollTo(0, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await mkdir('.impeccable/review', { recursive: true });
    await page.screenshot({
      path: `.impeccable/review/${width === 1440 ? 'desktop' : 'mobile'}.png`,
      fullPage: true,
    });
    await page.goto('/review');
    await page.getByRole('button', { name: /Start review/ }).click();
    await page.getByRole('button', { name: /Show answer|Reveal answer/ }).click();
    await expect(page.getByText('Imported from Anki · text practice')).toBeVisible();
    await expect(page.getByRole('link', { name: /Open full lesson/ })).toHaveCount(0);
  });
test('dashboard available review evidence and targeted sessions preserve grading and undo history', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 2);
  const stamp = new Date().toISOString();
  remote.review.cards[0].lapses = 2;
  remote.review.history = [
    {
      operationId: 'again-1',
      entryId: remote.entries[0].id,
      grade: 'again',
      reviewedAt: stamp,
      status: 'review',
    },
  ];
  remote.review.historySince = new Date(Date.now() - 7 * 86400000).toISOString();
  await page.route('**/api/vocabulary/collections', (r) =>
    r.fulfill({ json: { collections: [] } }),
  );
  await page.goto('/vocabulary');
  await expect(page.locator('#today-review')).toContainText('Again 1');
  await expect(page.locator('#revisit-words')).toContainText('2 recorded lapses');
  await page
    .locator('#revisit-words')
    .getByRole('button', { name: 'Select up to 20 words to revisit' })
    .click();
  await page.getByRole('button', { name: 'Practise selected words' }).click();
  await page.getByRole('button', { name: 'Reveal meaning & sentence' }).click();
  await expect(page.locator('.targeted-practice')).toContainText(
    'do not change your review schedule',
  );
  expect(remote.writes).toHaveLength(0);
  await page
    .locator('#explore-words')
    .getByRole('button', { name: 'Select up to 20 matching words' })
    .click();
  await page.getByRole('button', { name: 'Practise selected words' }).click();
  await page.getByRole('button', { name: 'Next word', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Short practice · 2 / 2' })).toBeVisible();
  await page
    .locator('#explore-words')
    .getByRole('checkbox', { name: `Select ${remote.entries[1].term}`, exact: true })
    .uncheck();
  await page.getByRole('button', { name: 'Practise selected words' }).click();
  await expect(page.getByRole('heading', { name: 'Short practice · 1 / 1' })).toBeFocused();
  await expect(page.getByRole('button', { name: 'Reveal meaning & sentence' })).toBeVisible();
});
test('Free vocabulary expansion stays behind entitlement notices', async ({ page, context }) => {
  await connect(context, 'free');
  const calls: string[] = [];
  await page.route('**/api/vocabulary/**', (route) => {
    calls.push(route.request().url());
    return route.fulfill({ status: 403, json: { error: 'Pro required' } });
  });
  await page.goto('/vocabulary');
  await expect(page.getByRole('heading', { name: 'Your next words' })).toHaveCount(0);
  expect(calls).toHaveLength(0);
});
