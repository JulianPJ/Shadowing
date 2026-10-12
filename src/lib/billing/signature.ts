/** Verify the untouched body with Web Crypto (constant-time HMAC verification). */
export async function verifyPaddleSignature(
  body: string,
  header: string | null,
  secret: string,
  now = Date.now(),
) {
  if (!header || header.length > 2048 || !secret) return false;
  const parts = header.split(';').map((part) => part.trim().split('='));
  const timestamps = parts.filter(([key]) => key === 'ts');
  if (timestamps.length !== 1 || !/^\d{1,12}$/.test(timestamps[0][1] ?? '')) return false;
  const timestamp = timestamps[0][1];
  if (Math.abs(now / 1000 - Number(timestamp)) > 5) return false;
  const signatures = parts.filter(
    ([key, value]) => key === 'h1' && /^[a-f0-9]{64}$/.test(value ?? ''),
  );
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  for (const [, hex] of signatures) {
    const signature = Uint8Array.from(hex.match(/../g)!, (byte) => parseInt(byte, 16));
    if (await crypto.subtle.verify('HMAC', key, signature, encoder.encode(`${timestamp}:${body}`)))
      return true;
  }
  return false;
}
