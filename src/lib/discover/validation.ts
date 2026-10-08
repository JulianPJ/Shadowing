import {
  BANDS,
  TOPICS,
  DEFAULT_FILTERS,
  DEFAULT_PREFERENCES,
  EMPTY_CONTEXT,
  validVideoId,
  type Filters,
  type Preferences,
  type Context,
} from './types';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function choice<T extends string>(value: unknown, choices: readonly T[], fallback: T): T {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('Invalid filter');
  return value as T;
}
export function normalizeFilters(value: unknown): Filters {
  const raw = value instanceof URLSearchParams ? Object.fromEntries(value) : record(value);
  const q = raw.q ?? '';
  if (typeof q !== 'string' || q.length > 120) throw new Error('Invalid search');
  return {
    band: choice(raw.band, ['for_you', 'all', ...BANDS.map((b) => b[0])], DEFAULT_FILTERS.band),
    topic: choice(raw.topic, ['all', ...(Object.keys(TOPICS) as (keyof typeof TOPICS)[])], 'all'),
    q: q.normalize('NFKC').trim().replace(/\s+/g, ' '),
    duration: choice(raw.duration, ['any', 'under5', '5to10', '10to20', 'over20'], 'any'),
    speed: choice(raw.speed, ['any', 'slow', 'natural', 'fast'], 'any'),
    captions: choice(raw.captions, ['any', 'reported', 'prepared'], 'any'),
    audience: choice(raw.audience, ['any', 'learner', 'native'], 'any'),
    sort: choice(raw.sort, ['recommended', 'newest', 'shortest', 'trending'], 'recommended'),
    diversity: choice(raw.diversity, ['balanced', 'wide'], 'balanced'),
  };
}
export function validatePreferences(value: unknown): Preferences {
  const raw = record(value);
  const topics = raw.topics ?? [];
  if (!Array.isArray(topics) || topics.length > 9) throw new Error('Invalid topics');
  return {
    preferredBand:
      raw.preferredBand == null
        ? null
        : choice(
            raw.preferredBand,
            BANDS.map((b) => b[0]),
            'n5_plus',
          ),
    topics: [
      ...new Set(
        topics.map((t) => choice(t, Object.keys(TOPICS) as (keyof typeof TOPICS)[], 'everyday')),
      ),
    ],
    duration: choice(
      raw.duration,
      ['any', 'under5', '5to10', '10to20', 'over20'],
      DEFAULT_PREFERENCES.duration,
    ),
    diversity: choice(raw.diversity, ['balanced', 'wide'], 'balanced'),
  };
}
export function validateContext(value: unknown): Context {
  const raw = record(value);
  const ids = (key: string, limit: number) => {
    const values = raw[key] ?? [];
    if (!Array.isArray(values) || values.length > limit || values.some((v) => !validVideoId(v)))
      throw new Error('Invalid context');
    return [...new Set(values)] as string[];
  };
  const fit = record(raw.vocabularyFit);
  if (Object.keys(fit).length > 40) throw new Error('Invalid vocabulary fit');
  const vocabularyFit: Record<string, number> = {};
  for (const [id, value] of Object.entries(fit)) {
    if (
      !validVideoId(id) ||
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 100
    )
      throw new Error('Invalid vocabulary fit');
    vocabularyFit[id] = value;
  }
  const comfortable = raw.comfortableSeconds ?? null;
  if (
    comfortable !== null &&
    (typeof comfortable !== 'number' ||
      !Number.isFinite(comfortable) ||
      comfortable < 0 ||
      comfortable > 14400)
  )
    throw new Error('Invalid duration context');
  return {
    ...EMPTY_CONTEXT,
    suggestedBand:
      raw.suggestedBand == null
        ? null
        : choice(
            raw.suggestedBand,
            BANDS.map((b) => b[0]),
            'n5_plus',
          ),
    preferredTopics: validatePreferences({ topics: raw.preferredTopics }).topics,
    comfortableSeconds: comfortable,
    completed: ids('completed', 80),
    saved: ids('saved', 40),
    seen: ids('seen', 120),
    ignored: ids('ignored', 120),
    liked: ids('liked', 120),
    vocabularyFit,
  };
}
export function filtersQuery(filters: Filters) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== DEFAULT_FILTERS[key as keyof Filters]) params.set(key, value);
  return params.toString();
}
