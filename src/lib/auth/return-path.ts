/** Auth callbacks accept app destinations only, never provider URLs or API routes. */
export function safeReturnPath(value: string | null | undefined, fallback = '/account'): string {
  if (!value || value.length > 2048 || /[\\\u0000-\u0020]/.test(value)) return fallback;
  try {
    const decoded = decodeURIComponent(value);
    if (
      /[\\\u0000-\u001f\u007f]/.test(decoded) ||
      !decoded.startsWith('/') ||
      decoded.startsWith('//')
    )
      return fallback;
    const url = new URL(value, 'https://hibiki.invalid');
    if (url.origin !== 'https://hibiki.invalid') return fallback;
    if (
      !/^\/(?:$|practice\/[^/]+$|library$|progress$|dictionary$|words$|review$|account$)/.test(
        url.pathname,
      )
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function authPath(
  screen: '/sign-in' | '/register' | '/reset-password',
  destination?: string | null,
) {
  return `${screen}?returnTo=${encodeURIComponent(safeReturnPath(destination))}`;
}
