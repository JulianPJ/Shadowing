import type { Page } from '@playwright/test';

/** Narrow screens fold practice options above the player; open them when they are folded. */
export async function openPracticeOptions(page: Page) {
  const toggle = page.getByRole('button', { name: /^Options/ });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
}
