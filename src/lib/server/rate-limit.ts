// Cloudflare rate-limit binding helpers, independent of the Worker runtime for testing.
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };

/**
 * True when the request should be rejected. Paid inference fails closed when the limiter is
 * unavailable; core public routes (caption preparation, translation) fail open so practice continues.
 * `route` is a constant name chosen by the handler, never the request path, so path spellings
 * the router treats as one route (`/api//quiz`) share one budget.
 */
export async function rateLimited(
  limiter: Limiter | undefined,
  request: Request,
  { failClosed, route }: { failClosed: boolean; route?: string },
) {
  const client = request.headers.get('cf-connecting-ip') || 'unknown';
  const key = route ? `${route}:${client}` : client;
  try {
    if (!limiter) throw new Error('Rate limiter unavailable');
    return !(await limiter.limit({ key })).success;
  } catch {
    return failClosed;
  }
}

/** Thrown by a rate-limited provider when its budget is spent; the handler returns `response`. */
export class InferenceDenied extends Error {
  constructor(readonly response: Response) {
    super('Inference rate limit reached');
  }
}

export function tooManyRequests(error: string) {
  return Response.json(
    { code: 'rate-limited', error },
    { status: 429, headers: { 'Cache-Control': 'no-store', 'Retry-After': '60' } },
  );
}

/** Reuses one in-flight or recent read for `ttlMs`; a failed read is not cached. */
export function cachedRead<T>(read: () => Promise<T>, ttlMs: number, now = () => Date.now()) {
  let cached: { at: number; value: Promise<T> } | null = null;
  return () => {
    const time = now();
    if (!cached || time - cached.at > ttlMs) {
      const value = read();
      const entry = { at: time, value };
      cached = entry;
      value.catch(() => {
        if (cached === entry) cached = null;
      });
    }
    return cached.value;
  };
}
