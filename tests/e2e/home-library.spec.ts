import { expect, test, type Page } from '@playwright/test';
import demo from '../../src/data/demo.json' with { type: 'json' };
import { transcriptRevision } from '../../src/lib/transcript';
import type { Lesson } from '../../src/lib/types';

function youtubeLesson(id: string, title: string, videoId: string): Lesson {
  const { mediaSource: _demoMedia, ...rest } = demo as Lesson;
  void _demoMedia;
  return { ...rest, id, title, source: 'youtube', videoId };
}

const walk = youtubeLesson('home-walk', 'A slow morning walk', 'aaaaaaaaaaa');
const cafe = youtubeLesson('home-cafe', 'At a neighbourhood café', 'bbbbbbbbbbb');
const done = { ...(demo as Lesson), id: 'home-done', title: 'A finished morning' };

async function seed(page: Page) {
  await page.addInitScript(
    ({ lessons, revision }) => {
      if (localStorage.getItem('home-seeded')) return;
      localStorage.setItem('home-seeded', 'yes');
      const positions = [4, 1, 0];
      lessons.forEach((lesson, i) => {
        localStorage.setItem(`hibiki:v1:lesson:${lesson.id}`, JSON.stringify(lesson));
        localStorage.setItem(`hibiki:v1:position:${lesson.id}`, String(positions[i]));
      });
      localStorage.setItem(
        'hibiki:v1:history',
        JSON.stringify(
          lessons.map((lesson, i) => ({
            lesson: { id: lesson.id },
            index: positions[i],
            updatedAt: Date.now() - i,
          })),
        ),
      );
      localStorage.setItem(
        'hibiki:v1:completion:home-done',
        JSON.stringify({ transcript: revision, completedAt: new Date().toISOString() }),
      );
      localStorage.setItem(
        'hibiki:v1:library:data',
        JSON.stringify({
          version: 1,
          pinned: [],
          queue: [
            {
              id: 'queued-market',
              url: 'https://www.youtube.com/watch?v=ccccccccccc',
              title: 'Exploring a local market',
              addedAt: new Date().toISOString(),
            },
          ],
        }),
      );
    },
    { lessons: [walk, cafe, done], revision: transcriptRevision(done) },
  );
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
  // Thumbnails are decorative here; keep the test independent of the network.
  await page.route('https://i.ytimg.com/**', (route) => route.fulfill({ status: 404 }));
});

test('first use puts the demo one action away in the first phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const demoLink = page.getByRole('link', { name: 'Try the demo', exact: true });
  await expect(demoLink).toBeInViewport();
  await expect(page.getByText('About a minute. No link or account needed.')).toBeVisible();
  await page.getByRole('button', { name: 'Use my own video', exact: true }).click();
  await expect(page.getByLabel('Paste a Japanese video link')).toBeFocused();
  await demoLink.click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
});

test('returning Home resumes the latest unfinished lesson at its next sentence', async ({
  page,
}) => {
  await seed(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Make a little room for Japanese.' }),
  ).toBeVisible();
  const resume = page.locator('.library-preview');
  await expect(resume.getByRole('heading', { name: walk.title })).toBeVisible();
  await expect(resume).toContainText(`Section 5 of ${walk.segments.length}`);
  await expect(resume.getByText(walk.segments[4].japanese, { exact: true })).toBeVisible();
  await expect(resume).toContainText(cafe.title);
  await expect(resume).not.toContainText(done.title);
  // Review is Pro, so a signed-out learner sees no review card.
  await expect(page.getByRole('heading', { name: 'Vocabulary review' })).toHaveCount(0);
  const button = page.getByRole('link', { name: 'Resume practice', exact: true });
  await expect(button).toBeInViewport();
  await button.click();
  await expect(page.getByTestId('current-japanese')).toHaveText(walk.segments[4].japanese);
});

test('Library shows lesson and Watch later preview cards with state-specific actions', async ({
  page,
}) => {
  await seed(page);
  await page.goto('/library');
  const lessons = page.locator('.library-lesson-list > li');
  await expect(lessons).toHaveCount(3);
  const walkCard = lessons.filter({ hasText: walk.title });
  await expect(walkCard.locator('img')).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/aaaaaaaaaaa/mqdefault.jpg',
  );
  // Only the most recent unfinished lesson carries the filled action.
  await expect(walkCard.getByRole('link', { name: 'Resume', exact: true })).toHaveClass(/primary/);
  await expect(
    lessons.filter({ hasText: cafe.title }).getByRole('link', { name: 'Resume', exact: true }),
  ).not.toHaveClass(/primary/);
  const doneCard = lessons.filter({ hasText: done.title });
  await expect(doneCard).toContainText('Completed');
  await expect(doneCard.getByRole('link', { name: 'Revisit', exact: true })).toBeVisible();
  const queued = page.locator('.library-queue li');
  await expect(queued).toHaveCount(1);
  await expect(queued.locator('img')).toHaveAttribute(
    'src',
    'https://i.ytimg.com/vi/ccccccccccc/mqdefault.jpg',
  );
  await expect(queued.getByRole('link', { name: 'Prepare' })).toHaveAttribute(
    'href',
    /\/prepare\?video=.*&from=library$/,
  );

  await page.getByRole('button', { name: 'Completed', exact: true }).click();
  await expect(page).toHaveURL(/\/library\?filter=completed$/);
  await expect(lessons).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Completed', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(lessons).toHaveCount(1);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('button', { name: 'Show all lessons' }).click();
  await expect(page).toHaveURL(/\/library$/);
  await expect(lessons).toHaveCount(3);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});
