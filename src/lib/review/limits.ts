/** Plain data shared by browser preferences and server validation; no browser dependencies. */
export type StudyLimits = { new: number | null; review: number | null };
export type ReviewLimits = { defaults: StudyLimits; decks: Record<string, StudyLimits> };
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const validId = (id: string) =>
  /^[\w-]{1,100}$/.test(id) && !['__proto__', 'prototype', 'constructor'].includes(id);
const validNumber = (value: unknown) =>
  value === null ||
  (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 10000);
function normalizedLimits(value: unknown): StudyLimits {
  const raw = record(value) ? value : {};
  return {
    new: validNumber(raw.new) ? (raw.new as number | null) : null,
    review: validNumber(raw.review) ? (raw.review as number | null) : null,
  };
}
export function normalizeReviewLimits(value: unknown): ReviewLimits {
  const raw = record(value) ? value : {};
  return {
    defaults: normalizedLimits(raw.defaults),
    decks: Object.fromEntries(
      Object.entries(record(raw.decks) ? raw.decks : {})
        .filter(([id]) => validId(id))
        .slice(0, 100)
        .map(([id, limits]) => [id, normalizedLimits(limits)]),
    ),
  };
}
export function validateReviewLimits(value: unknown): ReviewLimits {
  if (
    !record(value) ||
    Object.keys(value).some((key) => !['defaults', 'decks'].includes(key)) ||
    !record(value.decks) ||
    Object.keys(value.decks).length > 100
  )
    throw new Error('Invalid review limits');
  const entries: [string, unknown][] = [
    ['defaults', value.defaults],
    ...Object.entries(value.decks),
  ];
  for (const [id, limits] of entries) {
    if (
      !validId(id) ||
      !record(limits) ||
      Object.keys(limits).length !== 2 ||
      !Object.hasOwn(limits, 'new') ||
      !Object.hasOwn(limits, 'review') ||
      !validNumber(limits.new) ||
      !validNumber(limits.review)
    )
      throw new Error('Invalid review limits');
  }
  return normalizeReviewLimits(value);
}
