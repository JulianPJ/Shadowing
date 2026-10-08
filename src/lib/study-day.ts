/** Study days follow local midnight; scheduling timestamps remain UTC. */
export function studyTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
export function studyDay(stamp: string | number, timeZone = studyTimeZone()): string {
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid study date');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function shiftStudyDay(day: string, delta: number): string {
  return new Date(Date.parse(`${day}T12:00:00.000Z`) + delta * 86_400_000)
    .toISOString()
    .slice(0, 10);
}
