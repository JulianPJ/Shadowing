export async function serveDemoAsset(request: Request, fetchAsset: (request: Request) => Promise<Response>) {
  const source = new Request(request, { method: 'GET' });
  source.headers.delete('Range'); source.headers.delete('If-Range');
  const response = await fetchAsset(source);
  if (response.status !== 200) return response;
  // ASSETS can omit Content-Length. Read the trusted bundled MP4 with a hard 2 MB cap.
  const reader = response.body?.getReader();
  if (!reader) return response;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) { await reader.cancel(); return new Response('Demo asset exceeds its size limit', { status: 502 }); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  const headers = new Headers(response.headers);
  headers.set('Accept-Ranges', 'bytes'); headers.set('Content-Length', String(size));
  const validator = request.headers.get('If-Range');
  const allowed = !validator || validator === headers.get('ETag') && !validator.startsWith('W/') || validator === headers.get('Last-Modified');
  const match = request.headers.get('Range')?.match(/^bytes=(\d*)-(\d*)$/);
  if (!match || !allowed || request.method !== 'GET' || !match[1] && !match[2]) {
    return new Response(request.method === 'HEAD' ? null : body, { status: 200, headers });
  }
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(size - 1, Number(match[2])) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start || !match[1] && Number(match[2]) === 0) {
    headers.set('Content-Range', `bytes */${size}`); headers.set('Content-Length', '0');
    return new Response(null, { status: 416, headers });
  }
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(body.slice(start, end + 1), { status: 206, headers });
}
