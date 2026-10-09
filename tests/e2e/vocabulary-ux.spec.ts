import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { connect, seed } from '../helpers/retention-account';

for (const width of [320, 390, 768]) {
  test(`vocabulary ${width}px: filters and known/learning actions preserve saved context`, async ({
    page,
    context,
  }) => {
    const remote = await connect(context);
    await seed(remote, 2);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/words');
    await expect(page.getByRole('heading', { name: 'Vocabulary', exact: true })).toBeVisible();
    const filters = page.getByRole('group', { name: 'Filter words' });
    await filters.getByRole('button', { name: 'Learning', exact: true }).click();
    await expect(page.locator('.dictionary-entry')).toHaveCount(2);
    const first = page
      .locator('.dictionary-entry')
      .filter({ has: page.getByRole('heading', { name: '朝', exact: true }) });
    await first.getByRole('button', { name: 'Mark known', exact: true }).click();
    await expect(page.locator('.dictionary-entry')).toHaveCount(1);
    await filters.getByRole('button', { name: 'Known', exact: true }).click();
    await expect(first).toBeVisible();
    await expect
      .poll(() => remote.review.cards.find((c) => c.entryId === 'word-0')?.status)
      .toBe('suspended');
    expect(remote.entries).toHaveLength(2);
    await first.getByRole('button', { name: 'Learn again', exact: true }).click();
    await filters.getByRole('button', { name: 'Learning', exact: true }).click();
    await expect(page.locator('.dictionary-entry')).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByText('Export words', { exact: true }).click();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export CSV', exact: true }).click();
    const csv = await readFile((await (await download).path())!, 'utf8');
    expect(csv).toContain('朝');
    expect(csv).toContain(remote.entries[0].sourceSentence);
    const ankiDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export TSV (Anki)', exact: true }).click();
    const tsv = await readFile((await (await ankiDownload).path())!, 'utf8');
    expect(tsv).toContain('朝');
    expect(tsv).toContain('\t');
  });
}

test('saved-word search and empty results have recovery and revision-aware context', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 2);
  remote.entries[0].reading = 'あさ';
  await page.goto('/dictionary');
  await page.getByLabel('Search your words').fill('あさ');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.dictionary-entry')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open section', exact: true })).toHaveAttribute(
    'href',
    /&transcript=[a-f0-9]{64}$/,
  );
  await page.getByLabel('Search your words').fill('absent');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No words match.' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all words' }).click();
  await expect(page.locator('.dictionary-entry')).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete 朝', exact: true }).click();
  expect(remote.entries).toHaveLength(2);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete 朝', exact: true }).click();
  await expect(page.locator('.dictionary-entry')).toHaveCount(1);
  expect(remote.entries).toHaveLength(1);
});

test('other marked words remain editable without a saved review card', async ({ page }) => {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
  await page.addInitScript(() => {
    if (localStorage.getItem('hibiki:v1:knowledge:records')) return;
    localStorage.setItem(
      'hibiki:v1:knowledge:records',
      JSON.stringify([
        { lemma: '食べる', reading: 'たべる', state: 'known', updatedAt: new Date().toISOString() },
      ]),
    );
  });
  await page.goto('/words');
  await expect(page.getByRole('heading', { name: 'Other words you’ve marked' })).toBeVisible();
  await page.getByLabel('Status for 食べる').selectOption('learning');
  await page.reload();
  await expect(page.getByLabel('Status for 食べる')).toHaveValue('learning');
  await page.getByLabel('Status for 食べる').selectOption('ignored');
  await expect(page.getByLabel('Status for 食べる')).toHaveValue('ignored');
  await page.getByLabel('Status for 食べる').selectOption('unknown');
  await expect(page.getByLabel('Status for 食べる')).toHaveCount(0);
});
