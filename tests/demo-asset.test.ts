import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serveDemoAsset } from '../src/lib/demo-asset';

const bytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
const request = (range?: string, validator?: string, method = 'GET') =>
  new Request('https://app.example/demo.mp4', {
    method,
    headers: {
      ...(range ? { Range: range } : {}),
      ...(validator ? { 'If-Range': validator } : {}),
    },
  });
const asset = async (source: Request) => {
  assert.equal(source.headers.get('Range'), null);
  assert.equal(source.headers.get('If-Range'), null);
  return new Response(bytes, { headers: { 'Content-Type': 'video/mp4', ETag: '"demo"' } });
};

test('handles assets without Content-Length and serves exact/open-ended/suffix byte ranges', async () => {
  const full = await serveDemoAsset(request(), asset);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('Accept-Ranges'), 'bytes');
  assert.equal(full.headers.get('Content-Length'), '10');
  const head = await serveDemoAsset(request(undefined, undefined, 'HEAD'), asset);
  assert.equal(head.headers.get('Content-Length'), '10');
  assert.equal(await head.text(), '');
  for (const [range, expected, contentRange] of [
    ['bytes=2-4', [2, 3, 4], 'bytes 2-4/10'],
    ['bytes=7-', [7, 8, 9], 'bytes 7-9/10'],
    ['bytes=-2', [8, 9], 'bytes 8-9/10'],
    ['bytes=8-99', [8, 9], 'bytes 8-9/10'],
  ] as const) {
    const response = await serveDemoAsset(request(range), asset);
    assert.equal(response.status, 206);
    assert.equal(response.headers.get('Content-Range'), contentRange);
    assert.equal(response.headers.get('Content-Length'), String(expected.length));
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...expected]);
  }
});

test('rejects unsatisfiable ranges and ignores multipart ranges or stale validators', async () => {
  for (const range of ['bytes=10-', 'bytes=6-3', 'bytes=-0']) {
    const response = await serveDemoAsset(request(range), asset);
    assert.equal(response.status, 416);
    assert.equal(response.headers.get('Content-Range'), 'bytes */10');
  }
  for (const range of ['bytes=0-1,4-5', 'invalid', 'bytes=-'])
    assert.equal((await serveDemoAsset(request(range), asset)).status, 200);
  assert.equal((await serveDemoAsset(request('bytes=1-2', '"old"'), asset)).status, 200);
  assert.equal((await serveDemoAsset(request('bytes=1-2', '"demo"'), asset)).status, 206);
});

test('bounds asset buffering and preserves missing asset responses', async () => {
  const missing = new Response('Missing', { status: 404 });
  assert.equal(await serveDemoAsset(request(), async () => missing), missing);
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(2_000_001));
    },
    cancel() {
      cancelled = true;
    },
  });
  assert.equal((await serveDemoAsset(request(), async () => new Response(stream))).status, 502);
  assert.equal(cancelled, true);
});
