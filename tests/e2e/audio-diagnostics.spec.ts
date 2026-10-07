import { expect, test, type Page } from '@playwright/test';

async function recordDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Record yourself', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop recording', exact: true })).toBeVisible();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check recording locally', exact: true }),
  ).toBeVisible();
}

test('native recording diagnostics are explicit, local, and cleared with the recording', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  const inferenceRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(shadowing|transcribe)/.test(request.url())) inferenceRequests.push(request.url());
  });
  await recordDemo(page);
  const check = page.getByRole('region', { name: 'Local recording check', exact: true });
  await expect(check).toHaveCount(0);
  await page.getByRole('button', { name: 'Check recording locally', exact: true }).click();
  await expect(check).toBeVisible();
  await expect(check).toContainText('Measured on this device');
  await expect(page.getByLabel('Your recorded attempt')).toHaveAttribute('src', /^blob:/);
  expect(inferenceRequests).toEqual([]);
  await page.getByLabel('Your recorded attempt').evaluate(async (audio: HTMLAudioElement) => {
    await audio.play();
  });
  await expect
    .poll(() =>
      page
        .getByLabel('Your recorded attempt')
        .evaluate((audio: HTMLAudioElement) => audio.currentTime),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Record again', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Check recording locally', exact: true }),
  ).toBeDisabled();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: 'Stop recording', exact: true }).click();
  await expect(check).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Check recording locally', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Delete your recording', exact: true }).click();
  await expect(check).toHaveCount(0);
  await expect(page.getByLabel('Your recorded attempt')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Replay R', exact: true })).toBeEnabled();
});

test('a later account cancellation discards a manually stopped recording and releases the microphone', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    const streams: MediaStream[] = [];
    Object.defineProperty(window, '__hibikiRecorderTestStreams', { value: streams });
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      const stream = await getUserMedia(constraints);
      streams.push(stream);
      return stream;
    };
  });
  await page.goto('/');
  await page.getByRole('link', { name: 'Try the demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Record yourself', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Stop recording', exact: true });
  await expect(stop).toBeVisible();
  await page.waitForTimeout(1200);
  await stop.evaluate((button: HTMLButtonElement) => {
    button.click();
    window.dispatchEvent(new Event('hibiki:account-changing'));
  });
  await expect(page.getByRole('button', { name: 'Record yourself', exact: true })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByLabel('Your recorded attempt')).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const streams = (window as unknown as { __hibikiRecorderTestStreams: MediaStream[] })
        .__hibikiRecorderTestStreams;
      return (
        streams.length > 0 &&
        streams.every((stream) => stream.getTracks().every((track) => track.readyState === 'ended'))
      );
    }),
  ).toBe(true);
});

test('unsupported local decoding keeps recording playback and native practice available', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    Object.defineProperty(window, 'OfflineAudioContext', { value: undefined, configurable: true });
  });
  await recordDemo(page);
  await page.getByRole('button', { name: 'Check recording locally', exact: true }).click();
  await expect(page.locator('.recording-error[role="status"]')).toContainText(
    'Local recording checks are unavailable',
  );
  await expect(page.getByLabel('Your recorded attempt')).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('button', { name: 'Replay R', exact: true })).toBeEnabled();
});

test('accessible demo audio gives descriptive source activity at selected speed without changing scores', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      oscillator.frequency.value = 220;
      gain.gain.value = 0;
      oscillator.connect(gain).connect(destination);
      await context.resume();
      const now = context.currentTime;
      for (let phrase = 0; phrase < 3; phrase++) {
        gain.gain.setValueAtTime(0.2, now + phrase + 0.1);
        gain.gain.setValueAtTime(0, now + phrase + 0.5);
      }
      oscillator.start();
      oscillator.stop(now + 3);
      setTimeout(() => void context.close(), 3500);
      return destination.stream;
    };
  });
  const inferenceRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(shadowing|transcribe)/.test(request.url())) inferenceRequests.push(request.url());
  });
  await recordDemo(page);
  await page.getByRole('combobox', { name: 'Playback speed' }).selectOption('0.75');
  await page.getByRole('button', { name: 'Check recording locally', exact: true }).click();
  const check = page.getByRole('region', { name: 'Local recording check', exact: true });
  await expect(check).toContainText('Local source at 0.75×');
  await expect(check).toContainText('These measurements describe this excerpt');
  await expect(page.locator('.shadowing-score')).toHaveCount(0);
  expect(inferenceRequests).toEqual([]);
});

test('cancelling native decode suppresses stale diagnostics and section navigation clears playback', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['microphone']);
  await page.addInitScript(() => {
    const decode = OfflineAudioContext.prototype.decodeAudioData;
    OfflineAudioContext.prototype.decodeAudioData = function (bytes: ArrayBuffer) {
      return new Promise<AudioBuffer>((resolve, reject) => {
        setTimeout(() => decode.call(this, bytes).then(resolve, reject), 1200);
      });
    };
  });
  await recordDemo(page);
  await page.getByRole('button', { name: 'Check recording locally', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel local check', exact: true }).click();
  await page.waitForTimeout(1500);
  await expect(
    page.getByRole('region', { name: 'Local recording check', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Check recording locally', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Next section', exact: true }).click();
  await expect(page.getByLabel('Your recorded attempt')).toHaveCount(0);
});
