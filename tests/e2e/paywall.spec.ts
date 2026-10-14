import { expect, test } from '@playwright/test';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { emptySync } from '../../src/lib/sync/types';
import { mockDiscoverSync } from '../helpers/discover-account';
import { mockProAccount, proTestUser } from '../helpers/pro-account';

for (const signedIn of [false, true]) {
  test(`${signedIn ? 'signed-in Free' : 'anonymous'} can import media/subtitles, navigate and look up words without paid requests`, async ({
    page,
    context,
  }) => {
    await mockDiscoverSync(context);
    const user = signedIn ? { ...proTestUser, plan: 'free' } : null;
    await context.route('**/api/account/me', (route) =>
      route.fulfill({ json: { user, googleEnabled: false, emailEnabled: false } }),
    );
    await context.route('**/api/sync/bootstrap*', (route) =>
      route.fulfill({ json: { data: emptySync(), nextCursor: null } }),
    );
    await context.route('**/api/sync/push', (route) => {
      const data = route.request().postDataJSON();
      expect(data.sessions).toEqual([]);
      expect(data.bookmarks).toEqual([]);
      expect(data.attempts).toEqual([]);
      return route.fulfill({ json: { ok: true } });
    });
    const paidRequests: string[] = [];
    page.on('request', (request) => {
      if (
        /\/api\/(translate|difficulty|quiz|transcribe|shadowing|dictionary|review|knowledge)(\?|\/|$)/.test(
          request.url(),
        )
      )
        paidRequests.push(request.url());
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'Import media or subtitles' }).click();
    await page.getByRole('button', { name: 'Own media', exact: true }).click();
    await page.getByLabel('Audio or video file').setInputFiles(path.resolve('public/demo.mp4'));
    await expect(page.getByRole('button', { name: 'Auto-generate subtitles' })).toBeDisabled();
    await page.getByRole('button', { name: 'Upload own subtitles', exact: true }).click();
    await page.getByLabel('Japanese subtitle file').setInputFiles(path.resolve('public/demo.vtt'));
    await page.getByRole('button', { name: 'Start practicing' }).click();
    await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Record yourself', exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        'Voice recording, recorded playback and speaking analysis is a Hibiki Pro feature.',
      ),
    ).toBeVisible();
    await page.getByText('Advanced settings', { exact: true }).click();
    await expect(page.getByLabel('Source repeat count')).toBeDisabled();
    await expect(page.getByLabel('Section pause behavior')).toBeDisabled();
    await expect(
      page.getByLabel('Practice preset').locator('option[value="support"]'),
    ).toHaveAttribute('disabled', '');
    await page.getByTestId('current-japanese').locator('[data-lookup]').first().click();
    const lookup = page.getByRole('complementary', { name: 'Save vocabulary', exact: true });
    await expect(lookup.locator('.lexicon-definitions')).toBeVisible();
    await expect(lookup.getByRole('button', { name: 'Known', exact: true })).toHaveCount(0);
    await expect(
      lookup.getByText(
        'Saving words and sentences, review and word statuses is a Hibiki Pro feature.',
      ),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close vocabulary lookup' }).click();
    await page.getByRole('button', { name: 'Studio Mode', exact: true }).click();
    await page.getByRole('button', { name: 'Studio Mode', exact: true }).click();
    await page.getByRole('button', { name: 'Furigana', exact: true }).click();
    await page.getByLabel('Playback speed').selectOption('1.25');
    await page.getByRole('button', { name: 'Replay R' }).click();
    await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY');
    await page.getByRole('button', { name: 'Next section', exact: true }).click();
    await expect(
      page.getByText('Detailed lesson difficulty analysis is a Hibiki Pro feature.'),
    ).toBeVisible();
    expect(paidRequests).toEqual([]);
  });
}

test('Free retains subtitle translations but local Pro drill settings cannot enable automation', async ({
  page,
}) => {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
  await page.addInitScript(() => {
    localStorage.setItem(
      'hibiki:v1:drill:settings',
      JSON.stringify({
        preset: 'drill',
        repeats: 3,
        pause: 'timed',
        reveal: 'after-pause',
        responseSeconds: 2,
      }),
    );
    localStorage.setItem('hibiki:v1:preferences', JSON.stringify({ mode: 'shadowing', speed: 1 }));
  });
  await page.goto('/practice/demo');
  await expect(page.getByLabel('Practice preset')).toHaveValue('focus');
  await expect(page.getByRole('button', { name: 'Start hands-free drill' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Reveal translation T' }).click();
  await expect(page.locator('#current-translation')).toContainText(demo.segments[0].translation);
  for (const [route, message] of [
    ['/words', 'Saved vocabulary and word management'],
    ['/review', 'Spaced repetition reviews'],
    ['/profile', 'Detailed learning progress, weekly reports and daily goals'],
  ]) {
    await page.goto(route);
    await expect(page.getByText(`${message} is a Hibiki Pro feature.`)).toBeVisible();
  }
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();
});

test('downgrade preserves browser learning data and restoring Pro reveals paid controls again', async ({
  page,
  context,
}) => {
  await mockProAccount(context);
  let plan = 'pro';
  await context.route('**/api/account/me', (route) =>
    route.fulfill({
      json: { user: { ...proTestUser, plan }, googleEnabled: false, emailEnabled: false },
    }),
  );
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Record yourself', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save this section for practice' }).click();
  await page.getByRole('button', { name: 'Show saved sections' }).click();
  await expect(page.getByTestId('transcript-13')).toHaveCount(0);
  await page.evaluate(
    (id) =>
      localStorage.setItem(
        `hibiki:v1:account:${id}:knowledge:records`,
        JSON.stringify([{ lemma: '日本語', state: 'known' }]),
      ),
    proTestUser.id,
  );
  plan = 'free';
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button', { name: 'Record yourself', exact: true })).toHaveCount(0);
  await expect(page.getByTestId('transcript-13')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Show all sections' })).toBeDisabled();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`hibiki:v1:account:${id}:favorites:demo`),
      proTestUser.id,
    ),
  ).toContain(demo.segments[0].id);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`hibiki:v1:account:${id}:knowledge:records`),
      proTestUser.id,
    ),
  ).toContain('日本語');
  await page.goto('/profile');
  await expect(page.getByRole('button', { name: 'Download personal data' })).toBeEnabled();
  await context.route('**/api/account/export', (route) => {
    expect(route.request().headers()['x-hibiki-account']).toBe(proTestUser.id);
    return route.fulfill({ json: { vocabulary: [{ term: '日本語' }], learning: emptySync() } });
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download personal data' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('hibiki-personal-data.json');
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'));
  expect(exported.remote.vocabulary).toEqual([{ term: '日本語' }]);
  expect(exported.device['knowledge:records']).toEqual([{ lemma: '日本語', state: 'known' }]);
  plan = 'pro';
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Record yourself', exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`hibiki:v1:account:${id}:knowledge:records`),
      proTestUser.id,
    ),
  ).toContain('日本語');
});
