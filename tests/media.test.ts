import { installMemoryStorage } from './helpers/memory-storage';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveMediaUrl,
  migrateLesson,
  validateMediaFile,
  MEDIA_LIMIT,
  UnsupportedMediaError,
} from '../src/lib/media';
import { parseSubtitles } from '../src/lib/subtitles';
import { createImportedLesson } from '../src/lib/import-lesson';
import { createPrepareHandler } from '../src/lib/prepare';
import {
  needsUserTranscript,
  linkedTranscripts,
  transcriptHash,
} from '../src/lib/linked-transcripts';
import { CaptionError } from '../src/lib/providers/errors';
import { loadLesson, saveLesson } from '../src/lib/storage';
import { lessonIdentity, validateIdentity } from '../src/lib/learner-progress';
import { VimeoControls, type VimeoControlApi } from '../src/lib/vimeo-controls';
import type { Lesson, TranscriptionProvider } from '../src/lib/types';

const id = 'IJ6R4u05ppw';
const cues = [{ start: 0, end: 2, text: 'こんにちは。' }];
test('YouTube variants normalize to a stable media identity', async () => {
  for (const url of [
    `https://youtube.com/watch?v=${id}&t=3`,
    `https://youtu.be/${id}?si=share`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://youtube.com/shorts/${id}`,
    `https://youtube.com/live/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
  ]) {
    const { media } = await resolveMediaUrl(url);
    assert.equal(media.type, 'youtube');
    assert.equal(media.contentKey, `youtube:${id}`);
    assert.equal(media.canonicalUrl, `https://www.youtube.com/watch?v=${id}`);
  }
});
test('Vimeo video, embed, channel, group and unlisted links retain access data outside IDs', async () => {
  for (const url of [
    'https://vimeo.com/123456',
    'https://player.vimeo.com/video/123456',
    'https://vimeo.com/channels/staffpicks/123456',
    'https://vimeo.com/groups/shorts/videos/123456',
    'https://vimeo.com/123456/abcdef',
    'https://player.vimeo.com/video/123456?h=abcdef',
  ]) {
    const { media } = await resolveMediaUrl(url);
    assert.equal(media.type, 'vimeo');
    assert.equal(media.contentKey, 'vimeo:123456');
    if (url.includes('abcdef'))
      assert.equal(media.canonicalUrl, 'https://player.vimeo.com/video/123456?h=abcdef');
  }
});
test('direct HTTP(S) media canonicalizes host/fragments without deleting identity-bearing queries or exposing tokens in IDs', async () => {
  const a = await resolveMediaUrl('https://EXAMPLE.com:443/lesson.MP4?token=secret&v=2#t=2');
  const b = await resolveMediaUrl('https://example.com/lesson.MP4?token=secret&v=2');
  assert.equal(a.media.canonicalUrl, 'https://example.com/lesson.MP4?token=secret&v=2');
  assert.equal(a.media.contentKey, b.media.contentKey);
  assert.match(a.media.contentKey, /^direct:[a-f0-9]{64}$/);
  assert.ok(!a.media.contentKey.includes('secret'));
  assert.notEqual(
    a.media.contentKey,
    (await resolveMediaUrl('https://example.com/lesson.MP4?v=3')).media.contentKey,
  );
  for (const extension of [
    'm4v',
    'webm',
    'mov',
    'mp3',
    'm4a',
    'aac',
    'wav',
    'ogg',
    'oga',
    'ogv',
    'flac',
  ])
    assert.equal((await resolveMediaUrl(`http://example.com/a.${extension}`)).media.type, 'direct');
});
test('unsafe protocols, credentials, spoofed providers, malformed links and arbitrary iframe pages are rejected', async () => {
  for (const url of [
    'javascript:alert(1)',
    'data:video/mp4,bytes',
    'file:///test.mp4',
    'blob:https://example.com/a',
    'ftp://example.com/a.mp4',
    'https://user:secret@example.com/a.mp4',
    'bad link',
    'https://youtube.com/watch?v=no',
    'https://vimeo.com/channels/foo',
  ])
    await assert.rejects(resolveMediaUrl(url));
  for (const url of [`https://youtube.com.evil.test/watch?v=${id}`, 'https://example.com/watch'])
    await assert.rejects(resolveMediaUrl(url), UnsupportedMediaError);
});
const ass =
  '[Script Info]\nScriptType: v4.00+\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.25,0:00:04.50,Default,,0,0,0,,{\\i1}今日は\\N晴れです,ね。{\\i0}\\hはい。';
test('ASS parses Events, centiseconds, commas, Japanese, override tags and line/space escapes', () => {
  const [cue] = parseSubtitles(ass);
  assert.equal(cue.start, 1.25);
  assert.equal(cue.end, 4.5);
  assert.equal(cue.text, '今日は 晴れです,ね。 はい。');
  const [drawing] = parseSubtitles(
    ass.replace(
      '{\\i1}今日は\\N晴れです,ね。{\\i0}\\hはい。',
      '{\\p1}m 0 0 l 1 1{\\p0}こんにちは\\n日本語。',
    ),
  );
  assert.equal(drawing.text, 'こんにちは 日本語。');
});
test('SSA honors declared columns and standard Marked dialogue, skipping comments/styles', () => {
  const ssa =
    '[Script Info]\nScriptType: v4.00\n[V4 Styles]\nFormat: Name, Fontname\n[Events]\nFormat: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nComment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,comment\nDialogue: Marked=0,0:00:02.00,0:00:05.05,Default,,0,0,0,,日本語です。';
  assert.equal(parseSubtitles(ssa)[0].text, '日本語です。');
  assert.equal(parseSubtitles(ssa)[0].end, 5.05);
  assert.equal(
    parseSubtitles(
      '[Events]\nFormat: End, Start, Text\nDialogue: 0:00:05.00,0:00:01.00,こんにちは,世界。',
    )[0].text,
    'こんにちは,世界。',
  );
});
test('malformed ASS/SSA and untimed TXT fail clearly through the common validation', () => {
  for (const text of [
    '[Events]\nDialogue: too,few,fields',
    '[Script Info]\nScriptType: v4.00',
    ass.replace('0:00:01.25', '0:99:01.25'),
    ass.replace('0:00:04.50', '0:00:00.50'),
    ass.replace('Effect, Text', 'Effect, Other'),
    ass.replace('{\\i1}', '{\\i1'),
    'こんにちは。タイムスタンプはありません。',
  ])
    assert.throws(() => parseSubtitles(text));
});
test('existing SRT, VTT, JSON and timestamped TXT retain timings', () => {
  for (const text of [
    '1\n00:00:00,000 --> 00:00:02,000\nこんにちは。',
    'WEBVTT\n\n00:00.000 --> 00:02.000\nこんにちは。',
    JSON.stringify(cues),
    JSON.stringify({ segments: cues }),
    '00:00:00.000 --> 00:00:02.000\nこんにちは。',
  ]) {
    const [cue] = parseSubtitles(text);
    assert.equal(cue.start, 0);
    assert.equal(cue.end, 2);
    assert.equal(cue.text, 'こんにちは。');
  }
});
test('linked user transcript keeps media identity and independent transcript provenance; local imports have no contentKey', async () => {
  for (const url of [
    `https://youtu.be/${id}`,
    'https://vimeo.com/123456',
    'https://example.com/a.mp4',
  ]) {
    const resolved = {
      ...(await resolveMediaUrl(url)),
      title: 'Original title',
      author: 'Original author',
    };
    const lesson = await createImportedLesson({
      resolved,
      cues,
      transcriptType: 'user-upload',
      provenance: 'Imported subtitles',
    });
    assert.deepEqual(lesson.mediaSource, resolved.media);
    assert.equal(lesson.title, resolved.title);
    assert.equal(lesson.author, resolved.author);
    assert.equal(lesson.transcript?.type, 'user-upload');
    assert.equal(lesson.transcript?.transcriptHash, await transcriptHash(cues));
    assert.equal(lesson.videoId, resolved.media.type === 'youtube' ? id : undefined);
    validateIdentity(lessonIdentity(lesson, 'a'.repeat(64)));
  }
  const lesson = await createImportedLesson({
    fileName: 'clip.mov',
    cues,
    transcriptType: 'user-paste',
    provenance: 'Pasted transcript',
  });
  assert.equal(lesson.mediaSource?.type, 'local');
  assert.ok(!('contentKey' in lesson.mediaSource!));
  assert.match(lesson.id, /^upload-/);
});
test('old saved lessons migrate additively without changing lesson IDs, sections, source labels or local-media privacy', async () => {
  const values = new Map<string, string>();
  installMemoryStorage(values);
  for (const source of ['demo', 'youtube', 'upload'] as const) {
    const legacy: Lesson = {
      id: source,
      title: 'Old lesson',
      author: '',
      source,
      videoId: source === 'youtube' ? id : undefined,
      mediaUrl: source === 'upload' ? 'blob:old' : '/demo.mp4',
      mediaName: 'clip.mov',
      segments: [{ id: 'segment-1', start: 0, end: 2, japanese: 'こんにちは。' }],
      transcriptSource: source === 'youtube' ? 'relay-captions' : 'Imported subtitles',
    };
    values.set(`hibiki:v1:lesson:${source}`, JSON.stringify(legacy));
    const migrated = loadLesson(source)!;
    assert.equal(migrated.id, legacy.id);
    assert.deepEqual(migrated.segments, legacy.segments);
    assert.equal(migrated.mediaSource?.schemaVersion, 1);
    assert.equal(migrateLesson(migrated).id, source);
    saveLesson(migrated, 0);
    if (source === 'upload') {
      assert.equal(loadLesson(source)?.mediaUrl, undefined);
      assert.ok(!('contentKey' in migrated.mediaSource!));
    }
  }
  delete (globalThis as { localStorage?: unknown }).localStorage;
});
async function prepare(provider: TranscriptionProvider, url = `https://youtu.be/${id}`) {
  const handler = createPrepareHandler({
    captions: provider,
    fetchImpl: async () => Response.json({ title: 'A video', author_name: 'Author' }),
  });
  const response = await handler(
    new Request('http://localhost/api/prepare', { method: 'POST', body: JSON.stringify({ url }) }),
  );
  return (await response.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
}
test('caption-unavailable preparation preserves the resolved video for own-transcript continuation', async () => {
  const events = await prepare({
    name: 'relay',
    async transcribe() {
      throw new CaptionError('no-japanese-captions', 'No Japanese track', 'captions');
    },
  });
  const last = events.at(-1);
  assert.ok(needsUserTranscript(last.code));
  assert.equal(last.resolved.media.contentKey, `youtube:${id}`);
  assert.equal(last.resolved.title, 'A video');
  const lesson = await createImportedLesson({
    resolved: last.resolved,
    cues,
    transcriptType: 'user-upload',
    provenance: 'Imported subtitles',
  });
  assert.equal(lesson.id, `youtube-${id}`);
});
test('caption relay outages, blocked providers, private videos and internal failures do not masquerade as missing subtitles', async () => {
  for (const code of [
    'network',
    'network-timeout',
    'provider-blocked',
    'provider-incompatible',
    'video-unavailable',
    'internal',
  ] as const) {
    const events = await prepare({
      name: 'relay',
      async transcribe() {
        throw new CaptionError(code, 'Failure', 'relay');
      },
    });
    assert.equal(events.at(-1).code, code);
    assert.equal(needsUserTranscript(events.at(-1).code), false);
  }
});
test('YouTube preparation retains provider provenance; unintegrated providers use no-op lookup then transcript fallback without fetching media', async () => {
  const provider: TranscriptionProvider = {
    name: 'relay',
    async transcribe() {
      return { cues, provider: 'production-relay' };
    },
  };
  const result = (await prepare(provider)).at(-1).lesson;
  assert.equal(result.id, `youtube-${id}`);
  assert.equal(result.transcript.provider, 'production-relay');
  assert.equal(result.transcript.type, 'provider-captions');
  for (const url of ['https://vimeo.com/123456', 'https://example.com/a.mp4']) {
    const result = (
      await prepare(
        {
          name: 'unused',
          async transcribe() {
            throw new Error('Must not call');
          },
        },
        url,
      )
    ).at(-1);
    assert.equal(result.code, 'no-caption-provider');
    assert.ok(needsUserTranscript(result.code));
  }
  assert.equal(await linkedTranscripts.lookup({ contentKey: 'youtube:any', language: 'ja' }), null);
});
test('empty caption-provider metadata preserves the available official title and author', async () => {
  const result = (
    await prepare({
      name: 'relay',
      async transcribe() {
        return { cues, title: '', author: '' };
      },
    })
  ).at(-1).lesson;
  assert.equal(result.title, 'A video');
  assert.equal(result.author, 'Author');
});
test('browser media types support larger local files with a 1 GB bound', () => {
  for (const name of [
    'clip.mp4',
    'clip.m4v',
    'clip.webm',
    'clip.mov',
    'clip.mp3',
    'clip.m4a',
    'clip.aac',
    'clip.wav',
    'clip.ogg',
    'clip.oga',
    'clip.ogv',
    'clip.flac',
  ])
    validateMediaFile({ name, size: MEDIA_LIMIT, type: '' });
  validateMediaFile({ name: 'file.unusual', size: 10, type: 'video/custom' });
  validateMediaFile({ name: 'file.unknown', size: 10, type: '' });
  assert.throws(
    () => validateMediaFile({ name: 'a.mp4', size: MEDIA_LIMIT + 1, type: 'video/mp4' }),
    /1 GB/,
  );
  assert.throws(() => validateMediaFile({ name: 'doc.pdf', size: 10, type: 'application/pdf' }));
});
test('saved contracts reject unknown versions, unsafe remote URLs and global identity on local files', async () => {
  const lesson = await createImportedLesson({
    fileName: 'clip.mov',
    cues,
    transcriptType: 'user-paste',
    provenance: 'Pasted transcript',
  });
  for (const source of [
    { schemaVersion: 2, type: 'local', fileName: 'clip.mov' },
    { ...lesson.mediaSource, contentKey: 'global:local-file' },
    {
      schemaVersion: 1,
      type: 'direct',
      canonicalUrl: 'javascript:alert(1)',
      contentKey: 'direct:' + 'a'.repeat(64),
    },
  ])
    assert.throws(() => migrateLesson({ ...lesson, mediaSource: source } as Lesson));
});
test('Vimeo controls serialize pause/seek/play, retain real time, discard stale polls and report rate restrictions', async () => {
  const calls: string[] = [];
  let actual = 1;
  let fail = 0;
  let unavailable = false;
  const api: VimeoControlApi = {
    async pause() {
      calls.push('pause');
    },
    async play() {
      calls.push('play');
    },
    async setCurrentTime(seconds) {
      calls.push('seek');
      actual = seconds;
      return seconds;
    },
    async getCurrentTime() {
      return actual;
    },
    async setPlaybackRate() {
      throw new Error('Creator disabled rate changes');
    },
  };
  const controls = new VimeoControls(
    api,
    () => fail++,
    (value) => {
      unavailable = value;
    },
  );
  controls.pause();
  controls.seek(4.5);
  await controls.play();
  assert.deepEqual(calls, ['pause', 'seek', 'play']);
  assert.equal(controls.time(), 4.5);
  actual = 6;
  await controls.poll();
  assert.equal(controls.time(), 6);
  let resolvePoll!: (time: number) => void;
  api.getCurrentTime = () =>
    new Promise((resolve) => {
      resolvePoll = resolve;
    });
  const pending = controls.poll();
  controls.seek(12);
  resolvePoll(1);
  await pending;
  await controls.play();
  assert.equal(controls.time(), 12);
  controls.setSpeed(0.5);
  await controls.play();
  assert.equal(unavailable, true);
  assert.equal(fail, 0);
  controls.dispose();
});
