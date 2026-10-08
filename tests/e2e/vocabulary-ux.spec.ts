import { test, expect } from '@playwright/test';
import { connect, seed } from '../helpers/retention-account';

for (const width of [320, 390, 768]) {
  test(`vocabulary ${width}px: select in all words, assign an empty deck, tag and move without resetting reviews`, async ({
    page,
    context,
  }) => {
    const remote = await connect(context);
    await seed(remote, 2);
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/dictionary?view=decks');
    await page.getByLabel('New deck').fill('Travel');
    await page.getByRole('button', { name: 'Create deck', exact: true }).click();
    const deck = page.getByRole('article', { name: 'Travel deck' });
    await expect(deck).toContainText('This deck is empty');
    await expect(deck.getByRole('link', { name: 'Study · 0 ready' })).toBeVisible();
    const deckId = remote.review.decks.find((value) => value.name === 'Travel')!.id;
    await page.goto('/dictionary');
    await page.getByLabel('Select 朝', { exact: true }).check();
    await page.getByLabel('Destination deck').selectOption(deckId);
    await page.getByRole('button', { name: 'Add selected to deck', exact: true }).click();
    await expect
      .poll(() =>
        remote.review.memberships.some(
          (member) => member.entryId === 'word-0' && member.deckId === deckId,
        ),
      )
      .toBe(true);
    await page.getByLabel('Add tag to selected words').fill('旅行');
    await page.getByRole('button', { name: 'Create and apply tag', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Remove tag 旅行 from 朝' })).toBeVisible();
    await page.getByRole('button', { name: 'Move selected to deck', exact: true }).click();
    await expect
      .poll(() =>
        remote.review.memberships
          .filter((member) => member.entryId === 'word-0')
          .map((member) => member.deckId),
      )
      .toEqual([deckId]);
    expect(remote.review.cards).toHaveLength(2);
    expect(remote.review.cards.every((card) => card.revision === 0)).toBe(true);
    await page.getByLabel('Filter by deck').selectOption(deckId);
    await expect(page.locator('.dictionary-entry')).toHaveCount(1);
    await expect(
      page.getByRole('button', { name: 'Add selected to review', exact: true }),
    ).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.goto('/dictionary?view=decks');
    await expect(deck.getByRole('link', { name: 'Study · 1 ready' })).toBeVisible();
    await deck.getByText('Manage deck', { exact: true }).click();
    await deck.getByLabel('Deck name').fill('Holiday');
    await deck.getByRole('button', { name: 'Rename deck', exact: true }).click();
    await expect(page.getByRole('article', { name: 'Holiday deck' })).toBeVisible();
    expect(remote.review.cards).toHaveLength(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test('saved-word search, empty deck and no cached results have targeted recovery and revision-aware context', async ({
  page,
  context,
}) => {
  const remote = await connect(context);
  await seed(remote, 2);
  remote.entries[0].reading = 'あさ';
  await page.goto('/dictionary');
  await page.getByLabel('Search saved words').fill('あさ');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.locator('.dictionary-entry')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Open section', exact: true })).toHaveAttribute(
    'href',
    /&transcript=[a-f0-9]{64}$/,
  );
  await page.getByLabel('Search saved words').fill('absent');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'No words match these filters.' })).toBeVisible();
  await page.getByRole('button', { name: 'Show all saved words' }).click();
  await expect(page.locator('.dictionary-entry')).toHaveCount(2);
  page.once('dialog', (dialog) => dialog.dismiss());
  await page
    .locator('.dictionary-entry')
    .first()
    .getByRole('button', { name: 'Delete saved word' })
    .click();
  expect(remote.entries).toHaveLength(2);
});

test('word knowledge is distinct from cards, lookup does not filter the list, and changing filters clears selections', async ({
  page,
}) => {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
  await page.goto('/words');
  await expect(page.getByRole('heading', { name: 'Word knowledge', exact: true })).toBeVisible();
  await expect(page.locator('.knowledge-definitions')).toContainText(
    'Excluded from vocabulary coverage; kept in your list.',
  );
  await page.getByLabel('Find Japanese words').fill('食べました');
  await page.getByRole('button', { name: 'Look up a word', exact: true }).click();
  const lookup = page.getByRole('region', { name: 'Japanese dictionary lookup' });
  await lookup.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(page.getByLabel('State of 食べる')).toHaveValue('known');
  await page.getByRole('checkbox', { name: 'Select 食べる', exact: true }).check();
  await expect(page.getByRole('button', { name: 'Mark selected Learning' })).toBeEnabled();
  await page.getByLabel('Filter your words').fill('食');
  await expect(page.getByRole('button', { name: 'Mark selected Learning' })).toBeDisabled();
  await page.getByLabel('Filter word state').selectOption('ignored');
  await expect(page.getByRole('heading', { name: 'No words match these filters.' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear word filters' }).click();
  await expect(page.getByLabel('State of 食べる')).toHaveValue('known');
});
