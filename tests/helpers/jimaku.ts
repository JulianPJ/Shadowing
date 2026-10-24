import type { BrowserContext, Page, Route } from '@playwright/test';

/** Jimaku fixtures: one series with two episodes and an archive, served with Jimaku's CORS. */
export const jimakuSrt = (line: string) =>
  `\uFEFF1\n00:00:00,500 --> 00:00:02,500\n${line}\n\n2\n00:00:03,000 --> 00:00:05,000\nもう一度聞いてみましょう。\n`;

export async function mockJimaku(
  target: Page | BrowserContext,
  options: { key?: string; line?: string } = {},
) {
  const key = options.key ?? 'jimaku-test-key';
  const line = options.line ?? 'ジマクから届いた字幕です。';
  const requests: { path: string; authorization: string | null }[] = [];
  const cors = (route: Route) => ({
    'access-control-allow-origin': route.request().headers().origin ?? '*',
    'access-control-allow-headers': 'authorization, x-client-id',
    'access-control-allow-credentials': 'true',
  });
  const file = (name: string) => ({
    url: `https://jimaku.cc/entry/42/download/${encodeURIComponent(name)}`,
    name,
    size: 120,
    last_modified: '2026-09-01T00:00:00Z',
  });
  await target.route('https://jimaku.cc/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors(route) });
    if (url.pathname.startsWith('/entry/42/download/'))
      return route.fulfill({
        headers: { 'access-control-allow-origin': '*' },
        contentType: 'text/plain',
        body: jimakuSrt(line),
      });
    const authorization = request.headers().authorization ?? null;
    requests.push({ path: url.pathname + url.search, authorization });
    if (authorization !== key)
      return route.fulfill({
        status: 401,
        headers: cors(route),
        json: { error: 'unauthorized', code: 7 },
      });
    if (url.pathname === '/api/entries/search')
      return route.fulfill({
        headers: cors(route),
        json: /朝の散歩|asa|hyouka/i.test(url.searchParams.get('query') ?? '')
          ? [
              {
                id: 42,
                name: 'Asa no Sanpo',
                english_name: 'Morning Walk',
                japanese_name: '朝の散歩',
                flags: { anime: true },
                last_modified: '2026-09-01T00:00:00Z',
              },
            ]
          : [],
      });
    if (url.pathname === '/api/entries/42/files') {
      const files = [
        file('[Fixture] Asa no Sanpo - 01.ja.srt'),
        file('[Fixture] Asa no Sanpo - 02.ja.srt'),
        file('Asa no Sanpo (complete).zip'),
      ];
      const episode = url.searchParams.get('episode');
      return route.fulfill({
        headers: cors(route),
        json: episode ? files.filter((item) => item.name.includes(` - 0${episode}.`)) : files,
      });
    }
    return route.fulfill({ status: 404, headers: cors(route), json: { error: 'not found' } });
  });
  return requests;
}

/** Saves a Jimaku key for the signed-out learner before the page loads. */
export async function connectJimaku(target: Page | BrowserContext, key = 'jimaku-test-key') {
  await target.addInitScript((value) => {
    localStorage.setItem(
      'hibiki:v1:subtitle-sources',
      JSON.stringify({ jimaku: { key: value, savedAt: '2026-10-01T00:00:00.000Z' } }),
    );
  }, key);
}
