import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || 'http://localhost:3001',
    channel: process.env.CI ? 'chromium' : undefined,
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    launchOptions: {
      executablePath: process.env.PLAYWRIGHT_CHROME_PATH || undefined,
      args: ['--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
    },
  },
  reporter: 'list',
});
