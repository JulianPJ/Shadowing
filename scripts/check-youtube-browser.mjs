import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.argv[2] || 'http://localhost:3000';
const videoId = process.argv[3] || 'IJ6R4u05ppw';
const importedReport = process.argv[4];
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHROME_PATH ? undefined : 'chrome', executablePath: process.env.PLAYWRIGHT_CHROME_PATH,
  args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const report = { base, videoId, imported: !!importedReport, checks: [], errors: [] };
page.on('pageerror', error => report.errors.push(error.message));
const mark = (check, detail) => { report.checks.push({ check, detail }); console.log(check, detail ?? 'PASS'); };
await mkdir('artifacts', { recursive: true });
try {
  await page.goto(base);
  if (importedReport) {
    const fixture = JSON.parse(await readFile(importedReport, 'utf8'));
    const lesson = fixture.captions.flatMap(item => item.events).find(event => event.lesson?.videoId === videoId)?.lesson;
    if (!lesson) throw new Error('Import report has no lesson for the requested video.');
    await page.getByRole('button', { name: 'Import media or subtitles' }).click();
    await page.getByLabel('Video link', { exact: true }).fill(`https://www.youtube.com/watch?v=${videoId}`);
    await page.getByLabel('Paste timestamped transcript').fill(JSON.stringify(lesson.segments));
    await page.getByRole('button', { name: 'Start practicing' }).click();
  } else {
    await page.getByRole('textbox', { name: 'Paste a Japanese video link' }).fill(`https://www.youtube.com/watch?v=${videoId}`);
    // Capture the stream as the browser receives it; client navigation can discard CDP response bodies.
    let captured;
    await page.route('**/api/prepare', async route => {
      const response = await route.fetch();
      captured = { status: response.status(), text: await response.text() };
      await route.fulfill({ response });
    });
    await page.getByRole('button', { name: 'Start shadowing' }).click();
    await expect.poll(() => captured, { timeout: 35000 }).toBeTruthy();
    const events = captured.text.trim().split('\n').map(line => JSON.parse(line));
    if (!events.some(event => event.lesson?.segments?.length)) throw new Error(events.find(event => event.error)?.error ?? 'No lesson');
    mark('prepare', { status: captured.status, provider: events.find(event => event.lesson).lesson.transcriptSource, events: events.map(event => event.stage || event.code) });
  }
  await expect(page).toHaveURL(/\/practice\//, { timeout: 35000 });
  mark('navigation', page.url());
  await expect(page.locator('.youtube-host iframe')).toHaveAttribute('src', /youtube-nocookie\.com\/embed\//);
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled({ timeout: 35000 });
  mark('player-ready');
  const first = await page.getByTestId('current-japanese').innerText();
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY', { timeout: 20000 });
  mark('playback');
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN', { timeout: 30000 });
  mark('automatic-pause');
  await page.getByRole('button', { name: 'Replay R' }).click();
  await expect(page.getByTestId('playback-state')).toContainText('LISTEN CLOSELY', { timeout: 20000 });
  await expect(page.getByTestId('current-japanese')).toHaveText(first);
  await expect(page.getByTestId('playback-state')).toContainText('YOUR TURN', { timeout: 30000 });
  mark('replay');
  await page.getByTestId('transcript-2').click();
  await expect(page.getByTestId('transcript-2')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByTestId('current-japanese')).not.toHaveText(first);
  mark('transcript-navigation');
  await page.screenshot({ path: 'artifacts/youtube-browser.png', fullPage: true });
  await page.reload();
  await expect(page.getByTestId('transcript-2')).toHaveAttribute('aria-current', 'true');
  mark('persistence');
  if (report.errors.length) throw new Error(`Browser exceptions: ${report.errors.join('; ')}`);
} catch (error) {
  report.failure = error.message;
  console.error('Browser check failed:', error.message);
  await page.screenshot({ path: 'artifacts/youtube-browser-failure.png', fullPage: true });
  process.exitCode = 1;
} finally {
  await writeFile(`artifacts/youtube-browser-${videoId}-${Date.now()}.json`, JSON.stringify(report, null, 2));
  await browser.close();
}
