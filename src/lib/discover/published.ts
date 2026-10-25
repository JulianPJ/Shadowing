const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 86400],
  ['month', 30 * 86400],
  ['week', 7 * 86400],
  ['day', 86400],
  ['hour', 3600],
];

/** How long ago YouTube says a video was uploaded ("3 months ago"), or null without a valid date. */
export function uploadedAgo(publishedAt: string, now = Date.now()): string | null {
  const time = Date.parse(publishedAt);
  if (!Number.isFinite(time)) return null;
  const seconds = Math.max(0, (now - time) / 1000);
  const format = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  for (const [unit, size] of UNITS)
    if (seconds >= size) return format.format(-Math.floor(seconds / size), unit);
  return 'just now';
}
