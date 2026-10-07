/** Make our single-track MP4 mux output reproducible without changing samples or presentation times. */
export function canonicalizeAudioMp4(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const typeAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
  let headers = 0;
  const visit = (start: number, end: number) => {
    for (let at = start; at < end;) {
      if (at + 8 > end) throw new Error('The prepared audio container is incomplete.');
      const size = view.getUint32(at);
      if (size < 8 || at + size > end) throw new Error('The prepared audio container is invalid.');
      const type = typeAt(at);
      if (['moov', 'trak', 'mdia'].includes(type)) visit(at + 8, at + size);
      else if (['mvhd', 'tkhd', 'mdhd'].includes(type)) {
        const version = view.getUint8(at + 8);
        const dateBytes = version === 0 ? 8 : version === 1 ? 16 : 0;
        if (!dateBytes || size < 12 + dateBytes)
          throw new Error('The prepared audio container has unsupported header dates.');
        // Mediabunny writes wall-clock creation/modification dates on each mux. Removing these
        // permits exact-byte resume checks and also avoids sending irrelevant local timestamps.
        bytes.fill(0, at + 12, at + 12 + dateBytes);
        headers++;
      }
      at += size;
    }
  };
  visit(0, buffer.byteLength);
  if (headers !== 3) throw new Error('The prepared audio container is not a single audio track.');
  return buffer;
}
