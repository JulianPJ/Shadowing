import { expect, test, type Page } from '@playwright/test';
import type { Lesson } from '../../src/lib/types';
import source from '../../scripts/lexicon-source.json' with { type: 'json' };
import { connect } from '../helpers/retention-account';
import type { WordKnowledgeRecord } from '../../src/lib/knowledge/types';

const lesson: Lesson = {
  id: 'adaptive-one',
  title: 'Cats at home',
  author: 'Hibiki test script',
  source: 'demo',
  mediaUrl: '/demo.mp4',
  transcriptSource: 'Authored integration transcript',
  segments: [
    {
      id: 'cat-eats',
      start: 0,
      end: 4,
      japanese: '猫が魚を食べました。',
      translation: 'The cat ate fish.',
    },
    {
      id: 'cat-sleeps',
      start: 5,
      end: 9,
      japanese: '猫は家で寝ます。',
      translation: 'The cat sleeps at home.',
    },
    { id: 'estimated', start: 10, end: 14, japanese: '猫が魚を食べる。', estimated: true },
  ],
};
const nextLesson = {
  ...lesson,
  id: 'adaptive-two',
  title: 'Another cat lesson',
  segments: [{ id: 'again', start: 0, end: 4, japanese: '猫が魚を食べます。' }],
};
async function anonymous(page: Page) {
  await page.route('**/api/account/me', (route) =>
    route.fulfill({ json: { user: null, googleEnabled: false, emailEnabled: false } }),
  );
}
async function seed(page: Page) {
  await anonymous(page);
  await page.addInitScript(
    ({ first, second }) => {
      if (localStorage.getItem('adaptive-seeded')) return;
      localStorage.setItem('adaptive-seeded', 'true');
      for (const value of [first, second]) {
        localStorage.setItem('hibiki:v1:lesson:' + value.id, JSON.stringify(value));
        localStorage.setItem(
          'hibiki:v1:lesson-visibility:' + value.id,
          JSON.stringify('anonymous'),
        );
      }
      localStorage.setItem(
        'hibiki:v1:history',
        JSON.stringify([
          { lesson: first, index: 0, updatedAt: Date.now() },
          { lesson: second, index: 0, updatedAt: Date.now() },
        ]),
      );
      localStorage.setItem(
        'hibiki:v1:knowledge:records',
        JSON.stringify(
          ['魚', '食べる', '家', '寝る', 'が'].map((lemma) => ({
            lemma,
            reading: null,
            state: 'known',
            updatedAt: new Date().toISOString(),
          })),
        ),
      );
    },
    { first: lesson, second: nextLesson },
  );
}
test('full Japanese lexicon loads real readings, senses and deinflection without translation requests', async ({
  page,
}) => {
  await anonymous(page);
  let translationRequests = 0;
  page.on('request', (request) => {
    if (request.url().includes('/api/translate')) translationRequests++;
  });
  const manifest = await (
    await page.request.get(`/lexicon/${source.version}/manifest.json`)
  ).json();
  expect(manifest.entryCount).toBeGreaterThan(210000);
  expect(manifest.sourceSha256).toBe(source.sha256);
  expect(manifest.largestShardBytes).toBeLessThan(500000);
  await page.addInitScript(
    (value) => localStorage.setItem('hibiki:v1:lesson:adaptive-lexicon', JSON.stringify(value)),
    {
      ...lesson,
      id: 'adaptive-lexicon',
      segments: [
        { ...lesson.segments[0], japanese: '食べました。' },
        { ...lesson.segments[1], japanese: '斟酌します。' },
      ],
    },
  );
  await page.goto('/practice/adaptive-lexicon');
  await page.locator('#current-japanese .lookup-token').first().click();
  const lookup = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(lookup).toContainText('食べる');
  await expect(lookup).toContainText('たべる');
  await expect(lookup).toContainText('to eat');
  await expect(lookup).toContainText('Ichidan verb');
  await expect(lookup).toContainText('CC BY-SA 4.0');
  await lookup.getByRole('button', { name: 'Known', exact: true }).click();
  await page.goto('/words');
  await expect(page.getByLabel('Status for 食べる')).toHaveValue('known');
  await page.reload();
  await expect(page.getByLabel('Status for 食べる')).toHaveValue('known');
  await page.goto('/practice/adaptive-lexicon?section=cat-sleeps');
  await page.locator('#current-japanese .lookup-token').first().click();
  await expect(lookup).toContainText('しんしゃく');
  expect(translationRequests).toBe(0);
});

test('word states highlight across lessons and update coverage, bulk status and transcript recommendations', async ({
  page,
}) => {
  test.setTimeout(90000);
  await seed(page);
  await page.goto('/practice/adaptive-one');
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeEnabled();
  const coverage = page.getByRole('region', { name: 'Personal vocabulary coverage' });
  await expect(coverage).toContainText('67% marked Known');
  await expect(coverage.locator('.good-line')).toHaveCount(2);
  await expect(page.locator('#current-japanese [data-lemma="食べる"]')).toHaveAttribute(
    'data-word-state',
    'known',
  );
  await expect(page.locator('#current-japanese [data-lemma="が"]')).toHaveAttribute(
    'data-word-state',
    'known',
  );
  await expect(
    page.locator('.transcript-row').first().locator('[data-lemma="が"]'),
  ).toHaveAttribute('data-word-state', 'known');
  await expect(page.locator('#current-japanese [data-lemma="を"]')).not.toHaveAttribute(
    'data-word-state',
    /.+/,
  );
  await expect(coverage).toContainText('6 of 9 content-word occurrences');
  await expect(
    page.locator('.transcript-row').first().locator('[data-lemma="食べる"]'),
  ).toHaveAttribute('data-word-state', 'known');
  await coverage.getByRole('button', { name: 'Show these lines in transcript' }).click();
  await expect(page.locator('.transcript-row')).toHaveCount(2);
  await coverage.getByRole('button', { name: 'High-value lines' }).click();
  await expect(coverage).toContainText('Recurring Unknown word: 猫');
  await expect(page.locator('.transcript-row')).toHaveCount(2);
  await page.locator('#current-japanese [data-lemma="猫"]').click();
  const panel = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(panel).toContainText('cat');
  await panel.getByRole('button', { name: 'Known', exact: true }).click();
  await expect(page.locator('#current-japanese [data-lemma="猫"]')).toHaveAttribute(
    'data-word-state',
    'known',
  );
  await expect(page.locator('.transcript-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show full transcript' }).click();
  await expect(page.locator('.transcript-row')).toHaveCount(3);
  await page.goto('/practice/adaptive-two');
  await expect(page.locator('#current-japanese [data-lemma="猫"]')).toHaveAttribute(
    'data-word-state',
    'known',
  );
  await page.goto('/words');
  await expect(page.getByLabel('Status for 猫')).toHaveValue('known');
  await page.getByLabel('Status for 猫').selectOption('learning');
  await expect(page.getByLabel('Status for 猫')).toHaveValue('learning');
  await page.getByLabel('Status for 猫').selectOption('known');
  await page.goto('/practice/adaptive-one');
  await expect(coverage).toContainText('100% marked Known');
  await expect(coverage.locator('.good-line')).toHaveCount(0);
  await expect(page.locator('#current-japanese [data-lemma="猫"]')).toHaveAttribute(
    'data-word-state',
    'known',
  );
});

test('Free account knowledge survives offline edits and replays its durable outbox', async ({
  page,
  context,
}) => {
  await connect(context, 'free');
  let offline = true;
  const remote = new Map<string, WordKnowledgeRecord>();
  await context.route('**/api/knowledge*', (route) => {
    expect(route.request().headers()['x-hibiki-account']).toBe('retention-free');
    if (offline) return route.fulfill({ status: 503, json: { error: 'offline' } });
    if (route.request().method() === 'POST') {
      for (const record of route.request().postDataJSON().records) remote.set(record.lemma, record);
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: { records: [...remote.values()], nextCursor: null } });
  });
  await page.goto('/practice/demo');
  await page.locator('#current-japanese [data-lookup="今日"]').click();
  const lookup = page.getByRole('complementary', { name: 'Save vocabulary' });
  await expect(lookup).toContainText('today');
  await lookup.getByRole('button', { name: 'Known', exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:knowledge:outbox') ?? '[]',
          ).length,
      ),
    )
    .toBe(1);
  await page.goto('/words');
  await page.reload();
  await expect(page.getByLabel('Status for 今日')).toHaveValue('known');
  offline = false;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => remote.get('今日')?.state).toBe('known');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem('hibiki:v1:account:retention-free:knowledge:outbox') ?? '[]',
          ).length,
      ),
    )
    .toBe(0);
});
