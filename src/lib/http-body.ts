/** Read bounded bodies without trusting Content-Length or buffering beyond the limit. */
export class BodyLimitError extends Error {}

export async function readBoundedBytes(
  source: Pick<Request | Response, 'body'>,
  maxBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const reader = source.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new BodyLimitError('Body too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function readBoundedText(source: Pick<Request | Response, 'body'>, maxBytes: number) {
  return new TextDecoder().decode(await readBoundedBytes(source, maxBytes));
}
