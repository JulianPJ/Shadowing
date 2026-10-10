import { TOPICS, type Topic } from './types';

/**
 * Who a search was written for. This is acquisition intent only: a video found by a beginner
 * search is not a verified beginner video. Displayed bands come exclusively from validated
 * transcript analyses.
 */
export const LEVEL_TARGETS = ['beginner', 'intermediate', 'advanced'] as const;
export type LevelTarget = (typeof LEVEL_TARGETS)[number];
export const SEARCH_ORDERS = ['relevance', 'date', 'viewCount'] as const;
export type SearchOrder = (typeof SEARCH_ORDERS)[number];

export type Seed = {
  id: string;
  topic: Topic;
  query: string;
  levelTarget: LevelTarget | null;
  orientation: 'learner' | 'native' | null;
  runs: number;
  returned: number;
  accepted: number;
  lastRunAt: string | null;
};
export type Coverage = {
  total: number;
  levels: Partial<Record<LevelTarget, number>>;
  topics: Partial<Record<Topic, number>>;
};

const HOUR = 3600000;
/** Accepted share of returned results, once a seed has enough history to judge. */
export function seedYield(seed: Pick<Seed, 'runs' | 'returned' | 'accepted'>) {
  return seed.runs >= 2 && seed.returned > 0 ? seed.accepted / seed.returned : null;
}
/** Productive seeds return hourly; persistently unproductive ones back off to twice a day. */
export function seedCooldown(seed: Pick<Seed, 'runs' | 'returned' | 'accepted'>) {
  const value = seedYield(seed);
  return value === null || value >= 0.2 ? HOUR : value >= 0.08 ? 4 * HOUR : 12 * HOUR;
}
/** Each seed cycles through result orders, mixing evergreen (relevance/views) with fresh uploads. */
export function seedOrder(seed: Pick<Seed, 'runs'>): SearchOrder {
  return SEARCH_ORDERS[seed.runs % SEARCH_ORDERS.length];
}
/**
 * Deterministic priority among due seeds: waiting time prevents starvation, under-represented
 * level targets and topics are favoured, and measured yield adjusts within those bounds.
 */
export function seedPriority(seed: Seed, coverage: Coverage, now: number) {
  const waited = seed.lastRunAt ? (now - Date.parse(seed.lastRunAt)) / HOUR : 48;
  let value = Math.min(48, Math.max(0, waited));
  // Anti-starvation: any seed left waiting a day runs before coverage or yield preferences.
  if (waited >= 24) value += 100;
  const total = Math.max(1, coverage.total);
  if (seed.levelTarget)
    value += (1 / LEVEL_TARGETS.length - (coverage.levels[seed.levelTarget] ?? 0) / total) * 60;
  value += (1 / Object.keys(TOPICS).length - (coverage.topics[seed.topic] ?? 0) / total) * 30;
  const measured = seedYield(seed);
  if (measured !== null) value += (Math.min(measured, 0.6) - 0.2) * 40;
  return value;
}
/** Up to `count` due seeds, preferring distinct level targets within one execution. */
export function chooseSeeds(seeds: Seed[], coverage: Coverage, now: number, count = 2) {
  const ranked = [...seeds].sort(
    (a, b) =>
      seedPriority(b, coverage, now) - seedPriority(a, coverage, now) || a.id.localeCompare(b.id),
  );
  const chosen: Seed[] = [];
  for (const seed of ranked) {
    if (chosen.length >= count) break;
    if (chosen.some((c) => c.levelTarget && c.levelTarget === seed.levelTarget)) continue;
    chosen.push(seed);
  }
  for (const seed of ranked) {
    if (chosen.length >= count) break;
    if (!chosen.includes(seed)) chosen.push(seed);
  }
  return chosen;
}
// YouTube category IDs are coarse uploader choices; they only add browseable topic labels.
const CATEGORY_TOPICS: Record<string, Topic> = {
  '19': 'travel',
  '20': 'gaming',
  '22': 'vlogs',
  '23': 'entertainment',
  '24': 'entertainment',
  '25': 'news',
  '26': 'everyday',
  '27': 'education',
  '28': 'education',
};
export function categoryTopic(categoryId: string | null | undefined): Topic | null {
  return (categoryId && CATEGORY_TOPICS[categoryId]) || null;
}
