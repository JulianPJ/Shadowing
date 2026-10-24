import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { connectJimaku, mockJimaku } from '../helpers/jimaku';

// Subtitle sources: a Jimaku key on Profile, then subtitles found and loaded without a download.

test('Profile connects Jimaku with a checked key, then disconnects it', async ({ page }) => {
  const requests = await mockJimaku(page, { key: 'good-jimaku-key' });
  await page.goto('/profile');
  const section = page.getByRole('region', { name: 'Subtitle sources' });
  await expect(section).toBeVisible();
  const field = section.getByLabel('Jimaku API key');
  await field.fill('wrong-jimaku-key');
  await section.getByRole('button', { name: 'Connect Jimaku' }).click();
  await expect(section.getByRole('alert')).toContainText('did not accept this API key');
  await field.fill('good-jimaku-key');
  await section.getByRole('button', { name: 'Connect Jimaku' }).click();
  await expect(section.getByText('Connected on this device')).toBeVisible();
  expect(requests.map((request) => request.authorization)).toEqual([
    'wrong-jimaku-key',
    'good-jimaku-key',
  ]);
  expect(await page.evaluate(() => localStorage.getItem('hibiki:v1:subtitle-sources'))).toContain(
    'good-jimaku-key',
  );

  await page.reload();
  await expect(section.getByText('Connected on this device')).toBeVisible();
  await section.getByRole('button', { name: 'Disconnect' }).click();
  await expect(section.getByLabel('Jimaku API key')).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('hibiki:v1:subtitle-sources')),
  ).not.toContain('good-jimaku-key');
});

test('own media finds its episode on Jimaku and practises with those subtitles', async ({
  page,
}) => {
  await connectJimaku(page);
  const requests = await mockJimaku(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media or subtitles' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Own media', exact: true }).click();
  await dialog.getByLabel('Audio or video file').setInputFiles({
    name: '[Fixture] 朝の散歩 - 02 (1080p).mp4',
    mimeType: 'video/mp4',
    buffer: fs.readFileSync('public/demo.mp4'),
  });
  await dialog.getByRole('button', { name: 'Find on Jimaku', exact: true }).click();
  // The title and episode come from the file name, and the matching file is chosen.
  await expect(dialog.getByLabel('Title')).toHaveValue('朝の散歩');
  await expect(dialog.getByLabel('Episode')).toHaveValue('2');
  await expect(dialog.getByText('Asa no Sanpo (Morning Walk)')).toBeVisible();
  await expect(dialog.getByRole('radio', { name: /Asa no Sanpo - 02\.ja\.srt/ })).toBeChecked();
  await expect(dialog.getByRole('radio')).toHaveCount(1);
  expect(requests.map((request) => request.path)).toEqual([
    `/api/entries/search?query=${encodeURIComponent('朝の散歩')}`,
    '/api/entries/42/files?episode=2',
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await dialog.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByText('ジマクから届いた字幕です。').first()).toBeVisible();
  await expect(page.getByText('Subtitles from Jimaku')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
});

test('without a Jimaku key the search explains how to connect, then searches', async ({ page }) => {
  await mockJimaku(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Import media or subtitles' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Own media', exact: true }).click();
  await dialog.getByLabel('Audio or video file').setInputFiles({
    name: 'asa no sanpo 01.mp4',
    mimeType: 'video/mp4',
    buffer: fs.readFileSync('public/demo.mp4'),
  });
  await dialog.getByRole('button', { name: 'Find on Jimaku', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Start practicing' })).toBeDisabled();
  await dialog.getByLabel('Jimaku API key').fill('jimaku-test-key');
  await dialog.getByRole('button', { name: 'Connect Jimaku' }).click();
  await expect(dialog.getByRole('radio', { name: /Asa no Sanpo - 01\.ja\.srt/ })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'artifacts/import-jimaku-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Start practicing' }).click();
  await expect(page.getByText('Subtitles from Jimaku')).toBeVisible();
});
