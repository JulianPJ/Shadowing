import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMemoryStorage } from './helpers/memory-storage';
import { fileEpisode, rankSubtitleFiles, subtitleQuery } from '../src/lib/subtitle-sources/match';
import {
  JimakuError,
  downloadJimakuFile,
  jimakuFiles,
  jimakuKey,
  removeJimakuKey,
  saveJimakuKey,
  searchJimaku,
} from '../src/lib/subtitle-sources/jimaku';
import { decodeSubtitleBytes, parseSubtitles } from '../src/lib/subtitles';
import { transcriptLabel } from '../src/lib/caption-labels';
import { setStorageAccount } from '../src/lib/storage/browser';
import type { Lesson } from '../src/lib/types';

test('a watch page title and address become a title and episode to search', () => {
  assert.deepEqual(
    subtitleQuery({
      title: 'Watch Hyouka · Miruro',
      url: 'https://www.miruro.tv/watch/7Giys8FWQEEYMdO96HHvO6bBuD3oUK6N/hyouka?ep=1',
    }),
    { query: 'Hyouka', alternatives: [], episode: 1 },
  );
  assert.deepEqual(
    subtitleQuery({
      title: 'Watch Super no Ura de Yani Suu Futari Episode 8 English Sub - Site',
      url: 'https://www.miruro.tv/watch/nPdm01uvoVu_Ly-GxcbIDCMab2ExM7Mn/super-no-ura-de-yani-suu-futari?ep=8',
    }),
    { query: 'Super no Ura de Yani Suu Futari', alternatives: [], episode: 8 },
  );
  // A generic title falls back to the address's slug; episodes also come from the path.
  assert.deepEqual(
    subtitleQuery({ title: 'Player', url: 'https://example.com/anime/frieren-episode-12' }),
    { query: 'Player', alternatives: ['frieren'], episode: 12 },
  );
  assert.equal(subtitleQuery({ title: '葬送のフリーレン 第3話 | 配信' }).query, '葬送のフリーレン');
  assert.equal(subtitleQuery({ title: '葬送のフリーレン 第3話 | 配信' }).episode, 3);
  // Release file names: group tags, resolutions and episode numbers are not part of the title.
  assert.deepEqual(subtitleQuery({ fileName: '[SubsPlease] Hyouka - 05 (1080p) [ABCD1234].mkv' }), {
    query: 'Hyouka',
    alternatives: [],
    episode: 5,
  });
  assert.deepEqual(subtitleQuery({ title: '朝の散歩 · Fixture' }), {
    query: '朝の散歩',
    alternatives: [],
    episode: null,
  });
});

test('subtitle file names give their episode without mistaking resolutions or codecs', () => {
  assert.equal(
    fileEpisode('[NanakoRaws] Super no Ura de Yani Suu Futari S01E08 (CBC TV 1080p HEVC AAC).srt'),
    8,
  );
  assert.equal(fileEpisode('[AkihitoSubs] Hyouka - 01 [BD 1920x1080 x265 10Bit AC3].jp.ass'), 1);
  assert.equal(fileEpisode('ひょうか 第12話.srt'), 12);
  assert.equal(fileEpisode('hyouka_07.ja.srt'), 7);
  assert.equal(fileEpisode('Hyouka.E09.WEBRip.ja.srt'), 9);
  assert.equal(fileEpisode('Movie [1080p x264 AAC 5.1].srt'), null);
});

test('the episode, Japanese naming and SRT rank first; other episodes and archives are left out', () => {
  const file = (name: string, last_modified = '2026-01-01T00:00:00Z') => ({
    url: `https://jimaku.cc/entry/1/download/${encodeURIComponent(name)}`,
    name,
    size: 20000,
    last_modified,
  });
  const ranked = rankSubtitleFiles(
    [
      file('Show S01E07.srt'),
      file('Show S01E08.ass'),
      file('Show S01E08.en.srt'),
      file('Show S01E08.srt'),
      file('Show S01E08.ja.ass'),
      file('Show complete.zip'),
      file('Show notes.txt'),
    ],
    8,
  );
  assert.deepEqual(
    ranked.files.map((item) => item.name),
    ['Show S01E08.ja.ass', 'Show S01E08.srt', 'Show S01E08.ass', 'Show S01E08.en.srt'],
  );
  assert.ok(ranked.files.every((item) => item.matches));
  assert.equal(ranked.archives, 1);
  // Without an episode, every subtitle file is offered, newest first among equals.
  const all = rankSubtitleFiles([file('A.srt', '2025-01-01T00:00:00Z'), file('B.srt')], null);
  assert.deepEqual(
    all.files.map((item) => item.name),
    ['B.srt', 'A.srt'],
  );
});

test('the Jimaku key is kept per account on this device', () => {
  installMemoryStorage();
  const events: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: Object.assign(new EventTarget(), { localStorage }),
  });
  window.addEventListener('hibiki:subtitle-sources-change', () => events.push('change'));
  setStorageAccount('learner-a');
  assert.equal(jimakuKey(), null);
  saveJimakuKey('AAAAexampleKey123');
  assert.equal(jimakuKey(), 'AAAAexampleKey123');
  assert.ok(localStorage.getItem('hibiki:v1:account:learner-a:subtitle-sources'));
  setStorageAccount('learner-b');
  assert.equal(jimakuKey(), null);
  setStorageAccount('learner-a');
  removeJimakuKey();
  assert.equal(jimakuKey(), null);
  assert.deepEqual(events, ['change', 'change']);
  setStorageAccount(null);
});

test('Jimaku requests send the key and client id, and explain refused keys and limits', async () => {
  const calls: { url: string; headers: Record<string, string> }[] = [];
  const original = globalThis.fetch;
  let status = 200;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), headers: init?.headers as Record<string, string> });
    if (status !== 200)
      return new Response('{}', { status, headers: { 'x-ratelimit-reset-after': '12.5' } });
    return Response.json(
      String(input).includes('/files')
        ? [
            {
              url: 'https://jimaku.cc/entry/1/download/a.srt',
              name: 'a.srt',
              size: 10,
              last_modified: '',
            },
            { name: 'broken' },
          ]
        : [{ id: 1451, name: 'Hyouka', last_modified: '' }, { name: 'no id' }],
    );
  }) as typeof fetch;
  try {
    const entries = await searchJimaku('secret-key', 'Hyouka');
    assert.deepEqual(
      entries.map((entry) => entry.id),
      [1451],
    );
    assert.equal(calls[0].url, 'https://jimaku.cc/api/entries/search?query=Hyouka');
    assert.equal(calls[0].headers.Authorization, 'secret-key');
    assert.equal(calls[0].headers['X-Client-Id'], 'hibiki');
    const files = await jimakuFiles('secret-key', 1451, 8);
    assert.equal(calls[1].url, 'https://jimaku.cc/api/entries/1451/files?episode=8');
    assert.equal(files.length, 1);
    status = 401;
    await assert.rejects(searchJimaku('wrong', 'Hyouka'), (error: JimakuError) => {
      assert.equal(error.status, 401);
      return /did not accept/.test(error.message);
    });
    status = 429;
    await assert.rejects(searchJimaku('secret-key', 'Hyouka'), /in 13 seconds/);
  } finally {
    globalThis.fetch = original;
  }
});

test('downloads stay on jimaku.cc and decode Shift_JIS and UTF-16 subtitle files', async () => {
  const srt = '1\n00:00:01,000 --> 00:00:03,000\n今日はいい天気ですね。\n';
  const utf16 = new Uint8Array([
    0xff,
    0xfe,
    ...new Uint8Array(new Uint16Array([...srt].map((c) => c.charCodeAt(0))).buffer),
  ]);
  assert.equal(decodeSubtitleBytes(utf16.buffer), srt);
  // 今日 in Shift_JIS.
  const sjis = new Uint8Array([0x8d, 0xa1, 0x93, 0xfa]);
  assert.equal(decodeSubtitleBytes(sjis.buffer), '今日');
  assert.equal(
    parseSubtitles(decodeSubtitleBytes(new TextEncoder().encode(`\uFEFF${srt}`).buffer))[0].text,
    '今日はいい天気ですね。',
  );

  await assert.rejects(
    downloadJimakuFile({
      url: 'https://evil.example/a.srt',
      name: 'a.srt',
      size: 1,
      last_modified: '',
    }),
    /not on jimaku\.cc/,
  );
  await assert.rejects(
    downloadJimakuFile({
      url: 'https://jimaku.cc/a.srt',
      name: 'a.srt',
      size: 3 * 1024 * 1024,
      last_modified: '',
    }),
    /larger than 2 MB/,
  );
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response(utf16)) as unknown as typeof fetch;
  try {
    assert.equal(
      await downloadJimakuFile({
        url: '/entry/1/download/a.srt',
        name: 'a.srt',
        size: 10,
        last_modified: '',
      }),
      srt,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test('lessons made from Jimaku subtitles say where their Japanese came from', () => {
  const lesson = (provenance: string) =>
    ({
      source: 'page',
      transcriptSource: provenance,
      transcript: { type: 'user-upload', provenance },
    }) as unknown as Lesson;
  assert.equal(
    transcriptLabel(lesson('Jimaku · Hyouka · Hyouka - 01.jp.ass')),
    'Subtitles from Jimaku',
  );
  assert.equal(transcriptLabel(lesson('Imported subtitles')), 'Your subtitles');
});
