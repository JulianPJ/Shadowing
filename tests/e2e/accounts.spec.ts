import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import questions from '../../src/data/demo-quiz.json' with { type: 'json' };
import { createQuiz, newAttempt, transcriptKey, updateAttempt } from '../../src/lib/quiz';
import { createSession, lessonIdentity } from '../../src/lib/learner-progress';
import { emptySync, type AccountUser } from '../../src/lib/sync/types';
import { mergeSync } from '../../src/lib/sync/merge';
import { validateSync } from '../../src/lib/sync/validation';
import { verifyAttempt } from '../../src/lib/sync/quiz-verification';
import type { Lesson } from '../../src/lib/types';
import type { DictionaryEntry } from '../../src/lib/dictionary/types';
const user: AccountUser = {
  id: 'account-one',
  email: 'learner@example.com',
  name: 'Learner',
  emailVerified: true,
  plan: 'pro',
};
const freeUser: AccountUser = {
  ...user,
  id: 'account-free',
  email: 'free@example.com',
  name: 'Free learner',
  plan: 'free',
};
class Remote {
  data = emptySync();
  dictionary: DictionaryEntry[] = [];
  pushes: string[] = [];
  outage = false;
}
async function connect(
  context: BrowserContext,
  remote: Remote,
  state: { user: AccountUser | null },
) {
  await context.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: state.user, googleEnabled: true, emailEnabled: true } }),
  );
  await context.route('**/api/auth/list-accounts', (route) =>
    route.fulfill({ json: [{ providerId: 'credential' }] }),
  );
  await context.route('**/api/auth/sign-out', (route) => {
    state.user = null;
    return route.fulfill({ json: { success: true } });
  });
  await context.route('**/api/sync/bootstrap*', (route) =>
    route.fulfill({
      status: remote.outage ? 503 : 200,
      json: { data: remote.data, nextCursor: null },
    }),
  );
  await context.route('**/api/sync/push', async (route) => {
    if (remote.outage) {
      await route.fulfill({ status: 503, json: { error: 'Offline' } });
      return;
    }
    const data = validateSync(route.request().postDataJSON());
    for (let i = 0; i < data.attempts.length; i++)
      data.attempts[i] = await verifyAttempt(data.attempts[i]);
    remote.pushes.push(route.request().postData()!);
    remote.data = mergeSync(remote.data, data);
    await route.fulfill({ json: { ok: true } });
  });
  await context.route('**/api/dictionary*', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { entries: remote.dictionary } });
      return;
    }
    const body = route.request().postDataJSON() as
      | { action: 'delete'; id: string }
      | {
          action: 'save';
          entry: Omit<DictionaryEntry, 'id' | 'normalizedTerm' | 'createdAt' | 'updatedAt'>;
        };
    if (body.action === 'delete') {
      remote.dictionary = remote.dictionary.filter((entry) => entry.id !== body.id);
      await route.fulfill({ json: { ok: true } });
      return;
    }
    const now = new Date().toISOString();
    const normalizedTerm = body.entry.term.normalize('NFKC').trim().toLocaleLowerCase();
    const existing = remote.dictionary.find(
      (entry) =>
        entry.normalizedTerm === normalizedTerm &&
        entry.source.lessonId === body.entry.source.lessonId &&
        entry.source.segmentId === body.entry.source.segmentId,
    );
    const entry: DictionaryEntry = {
      ...body.entry,
      id: existing?.id ?? crypto.randomUUID(),
      normalizedTerm,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    remote.dictionary = [entry, ...remote.dictionary.filter((value) => value.id !== entry.id)];
    await route.fulfill({ json: { entry } });
  });
}
async function account(page: Page) {
  await page.goto('/account');
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  await page.getByRole('button', { name: 'Sync now' }).click();
  await expect(page.getByText('Your progress is synced.', { exact: true })).toBeVisible();
}
async function anonymousFixture() {
  const key = await transcriptKey(demo),
    session = createSession(lessonIdentity(demo as Lesson, key), new Date().toISOString());
  session.completed = true;
  session.completedAt = session.updatedAt;
  session.lastSectionId = demo.segments[0].id;
  const quiz = await createQuiz(questions, demo),
    attempt = updateAttempt(
      newAttempt(quiz, demo),
      quiz,
      quiz.questions.map((q) => q.correctIndex),
      true,
    );
  const privateLesson = {
    ...demo,
    id: 'private-video',
    source: 'direct',
    mediaUrl: 'https://media.example/video.mp4?token=SECRET',
    mediaSource: {
      schemaVersion: 1,
      type: 'direct',
      canonicalUrl: 'https://media.example/video.mp4?token=SECRET',
      contentKey: `direct:${'a'.repeat(64)}`,
    },
    transcript: {
      schemaVersion: 1,
      type: 'user-paste',
      language: 'ja',
      provenance: 'private-user-text',
      normalizationVersion: 1,
      segmentationVersion: 1,
    },
    segments: demo.segments.map((s) => ({ ...s, japanese: 'PRIVATE_TRANSCRIPT_TEXT' })),
  };
  return {
    'hibiki:v1:lesson:demo': demo,
    'hibiki:v1:lesson:private-video': privateLesson,
    'hibiki:v1:history': [
      { lesson: demo, index: 0, updatedAt: Date.now() },
      { lesson: privateLesson, index: 0, updatedAt: Date.now() },
    ],
    'hibiki:v1:learner-history': {
      schemaVersion: 1,
      migrationVersion: 1,
      sessions: [session],
      archives: [],
      difficulties: [],
    },
    'hibiki:v1:preferences': {
      mode: 'continuous',
      speed: 0.75,
      studioMode: false,
      furigana: false,
    },
    'hibiki:v1:favorites:demo': [demo.segments[0].id],
    'hibiki:v1:quiz-attempts': [attempt],
    'hibiki:v1:recording': 'PRIVATE_AUDIO',
  };
}

test('account plan controls paid UI without hiding the core account experience', async ({
  page,
  context,
}) => {
  const remote = new Remote();
  await connect(context, remote, { user: freeUser });
  await account(page);
  await expect(page.getByText('Hibiki Free', { exact: true })).toBeVisible();
  await page.goto('/dictionary');
  await expect(page.getByText('No saved vocabulary yet.')).toBeVisible();
  await expect(page.getByText('Opening your dictionary…')).toHaveCount(0);
});

test('explicit first-login import preserves local data and excludes private content, recordings and signed URLs', async ({
  page,
  context,
}) => {
  const remote = new Remote();
  await connect(context, remote, { user });
  const values = await anonymousFixture();
  await page.addInitScript((values) => {
    for (const [key, value] of Object.entries(values))
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, values);
  await page.goto('/account');
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toBeVisible();
  expect(remote.data.sessions).toHaveLength(0);
  await page.getByRole('button', { name: 'Add device progress' }).click();
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toHaveCount(0);
  await expect.poll(() => remote.data.sessions.length).toBeGreaterThan(0);
  await expect.poll(() => remote.data.attempts.length).toBe(1);
  const payload = remote.pushes.join('\n');
  for (const secret of [
    'PRIVATE_TRANSCRIPT_TEXT',
    'PRIVATE_AUDIO',
    'token=SECRET',
    'mediaUrl',
    'canonicalUrl',
    'quote',
  ])
    expect(payload).not.toContain(secret);
  const count = remote.data.sessions.length;
  await account(page);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sync now' })).toBeVisible();
  expect(remote.data.sessions.length).toBe(count);
  expect(await page.evaluate(() => !!localStorage.getItem('hibiki:v1:learner-history'))).toBe(true);
});
test('declining device import leaves anonymous history local across reloads and account changes', async ({
  page,
  context,
}) => {
  const remote = new Remote(),
    state = { user: user as AccountUser | null };
  await connect(context, remote, state);
  const values = await anonymousFixture();
  await page.addInitScript((values) => {
    for (const [key, value] of Object.entries(values))
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(value));
  }, values);
  await page.goto('/account');
  await page.getByRole('button', { name: 'Keep it on this device' }).click();
  await account(page);
  expect(remote.data.sessions).toHaveLength(0);
  expect(remote.data.attempts).toHaveLength(0);
  expect(remote.data.bookmarks).toHaveLength(0);
  await page.reload();
  await expect(page.getByRole('complementary', { name: 'Import device progress' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await page.goto('/progress');
  await expect(page.locator('.progress-summary')).toContainText('Lessons practised');
});
test('two devices sync preferences, bookmarks, completion and retakes; offline edits retry without duplicates', async ({
  browser,
}) => {
  const a = await browser.newContext(),
    b = await browser.newContext(),
    remote = new Remote();
  await connect(a, remote, { user });
  await connect(b, remote, { user });
  const pageA = await a.newPage(),
    pageB = await b.newPage();
  try {
    await account(pageA);
    await expect(pageA.getByRole('complementary', { name: 'Import device progress' })).toHaveCount(
      0,
    );
    await account(pageB);
    await pageA.goto('/practice/demo');
    await expect(pageA.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
    await pageA.getByRole('button', { name: 'Save this section for practice' }).click();
    await pageA.getByRole('button', { name: 'Studio Mode', exact: true }).click();
    await pageA.getByRole('button', { name: 'Furigana', exact: true }).click();
    await pageA.getByTestId('transcript-13').click();
    await pageA.getByRole('button', { name: /Finish practice/ }).click();
    await account(pageA);
    await expect.poll(() => remote.data.bookmarks.filter((b) => !b.deleted).length).toBe(1);
    await expect.poll(() => remote.data.lessons.some((l) => l.completed)).toBe(true);
    // Seed validated retakes through the account cache as the existing quiz facade does.
    const quiz = await createQuiz(questions, demo),
      attempts = [1, 2].map(() =>
        updateAttempt(
          newAttempt(quiz, demo),
          quiz,
          quiz.questions.map((q) => q.correctIndex),
          true,
        ),
      );
    await pageA.evaluate((attempts) => {
      localStorage.setItem('hibiki:v1:account:account-one:quiz-attempts', JSON.stringify(attempts));
    }, attempts);
    await pageA.getByRole('button', { name: 'Sync now' }).click();
    await expect.poll(() => remote.data.attempts.length).toBe(2);
    await account(pageB);
    await pageB.goto('/practice/demo');
    await expect(pageB.getByRole('button', { name: 'Studio Mode', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(pageB.getByRole('button', { name: 'Furigana', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await pageB.getByTestId('transcript-0').click();
    await expect(pageB.getByRole('button', { name: 'Unsave this section' })).toBeVisible();
    remote.outage = true;
    await pageB.getByRole('button', { name: 'Unsave this section' }).click();
    if (!(await pageB.getByRole('button', { name: 'Pause', exact: true }).count()))
      await pageB.getByRole('button', { name: /^(Play|Listen)$/ }).click();
    await expect
      .poll(() => pageB.locator('video').evaluate((v: HTMLVideoElement) => v.currentTime))
      .toBeGreaterThan(0.2);
    await pageB.getByRole('button', { name: 'Studio Mode', exact: true }).click();
    await pageB.goto('/account');
    await expect(pageB.getByText(/Progress is saved on this device/)).toBeVisible();
    expect(
      await pageB.evaluate(() =>
        JSON.parse(localStorage.getItem('hibiki:v1:account:account-one:favorites:demo')!),
      ),
    ).toEqual([]);
    remote.outage = false;
    await pageB.getByRole('button', { name: 'Sync now' }).click();
    await expect(pageB.getByText('Your progress is synced.', { exact: true })).toBeVisible();
    await account(pageA);
    await pageA.goto('/practice/demo');
    await pageA.getByTestId('transcript-0').click();
    await expect(
      pageA.getByRole('button', { name: 'Save this section for practice' }),
    ).toBeVisible();
    expect(remote.data.attempts).toHaveLength(2);
    expect(new Set(remote.data.sessions.map((s) => s.id)).size).toBe(remote.data.sessions.length);
  } finally {
    await a.close();
    await b.close();
  }
});

test('auth screens expose configured providers without offering unavailable email delivery', async ({
  page,
  context,
}) => {
  await context.route('**/api/account/me', (route) =>
    route.fulfill({
      json: { user: null, googleEnabled: true, emailEnabled: false },
    }),
  );

  await page.goto('/register');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await expect(page.getByText('Google sign-in is awaiting configuration.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Create account' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText(
    'Email sign-up is awaiting email service setup.',
  );

  await page.goto('/reset-password');
  await expect(page.getByRole('button', { name: 'Send password link' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText(
    'Email password reset is awaiting email service setup.',
  );

  await page.goto('/sign-in');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
  await page.getByLabel('Email').fill('learner@example.com');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Resend verification email' })).toHaveCount(0);
});

test('selected Japanese saves to the account dictionary with source context and replay link', async ({
  page,
  context,
}) => {
  const remote = new Remote();
  await connect(context, remote, { user });
  await context.route('**/api/translate', (route) =>
    route.fulfill({ json: { translation: 'lookup meaning', provider: 'Test translator' } }),
  );
  await account(page);
  await page.goto('/practice/demo');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();

  const token = page.locator('#current-japanese .lookup-token').first();
  const term = (await token.textContent())!.trim();
  expect(term.length).toBeGreaterThan(0);
  await token.click();

  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(panel).toBeVisible();
  await expect(page.getByLabel('Vocabulary meaning')).toHaveValue('lookup meaning');
  await expect(page.getByLabel('Source sentence meaning')).toHaveValue(
    demo.segments[0].translation,
  );
  await page.getByRole('button', { name: 'Save to dictionary' }).click();
  await expect(page.getByRole('button', { name: 'Saved', exact: true })).toBeVisible();
  await expect.poll(() => remote.dictionary.length).toBe(1);
  expect(remote.dictionary[0].term).toBe(term);
  expect(remote.dictionary[0].source.segmentId).toBe(demo.segments[0].id);
  expect(remote.dictionary[0].source.start).toBe(demo.segments[0].start);
  expect(remote.dictionary[0].source.end).toBe(demo.segments[0].end);

  await page.getByRole('link', { name: 'View dictionary' }).click();
  await expect(page.getByRole('heading', { name: 'Personal dictionary' })).toBeVisible();
  await expect(page.getByRole('heading', { name: term })).toBeVisible();
  await expect(page.getByText(demo.segments[0].japanese, { exact: true })).toBeVisible();
  const open = page.getByRole('link', { name: 'Open section' });
  await expect(open).toHaveAttribute(
    'href',
    `/practice/demo?section=${encodeURIComponent(demo.segments[0].id)}`,
  );
  await open.click();
  await expect(page).toHaveURL(new RegExp(`section=${demo.segments[0].id}`));
  await expect(page.getByTestId('current-japanese')).toHaveText(demo.segments[0].japanese);

  await page.goto('/dictionary');
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByText('No saved vocabulary yet.')).toBeVisible();
  expect(remote.dictionary).toHaveLength(0);
});
