import { sha256 } from '../hash';
import {
  BANDS,
  TOPICS,
  type Band,
  type Card,
  type Context,
  type Feed,
  type Filters,
  type Video,
} from './types';
import { eligible } from './eligibility';
import {
  bandDistance,
  bandIndex,
  explain,
  learnerProfile,
  scoreParts,
  totalScore,
  type Profile,
} from './score';

/**
 * Progression hypothesis for For you: about six comfortable picks to two easier and two stretch
 * picks in every ten. Slots only reorder verified matches that exist; when a bucket is empty the
 * next best video takes the slot, so scarce verified levels are never padded with guesses.
 */
const PROGRESSION = [
  'comfort',
  'comfort',
  'easier',
  'comfort',
  'stretch',
  'comfort',
  'comfort',
  'easier',
  'comfort',
  'stretch',
] as const;
type Bucket = (typeof PROGRESSION)[number];
function bucket(video: Video, profile: Profile): Bucket | null {
  const distance = bandDistance(video, profile);
  return distance === 0
    ? 'comfort'
    : distance === -1
      ? 'easier'
      : distance === 1
        ? 'stretch'
        : null;
}
function blendDifficulty(sorted: Video[], profile: Profile) {
  const remaining = [...sorted];
  const result: Video[] = [];
  for (let slot = 0; remaining.length; slot++) {
    const want = PROGRESSION[slot % PROGRESSION.length];
    const index = remaining.findIndex((v) => bucket(v, profile) === want);
    // An empty bucket yields to the best remaining video of any kind.
    result.push(remaining.splice(index < 0 ? 0 : index, 1)[0]);
  }
  return result;
}
export function rankVideos(
  videos: Video[],
  filters: Filters,
  context: Context,
  now: number,
): Card[] {
  const profile = learnerProfile(videos, context);
  const scores = new Map(
    videos.map((v) => [v.videoId, totalScore(scoreParts(v, context, profile, now))]),
  );
  const sorted = videos
    .filter((v) => !context.ignored.includes(v.videoId))
    .sort((a, b) => {
      const order =
        filters.sort === 'newest'
          ? b.indexedAt.localeCompare(a.indexedAt)
          : filters.sort === 'shortest'
            ? a.durationSeconds - b.durationSeconds
            : filters.sort === 'trending'
              ? (b.popularity ?? -1) - (a.popularity ?? -1)
              : scores.get(b.videoId)! - scores.get(a.videoId)!;
      return order || b.indexedAt.localeCompare(a.indexedAt) || a.videoId.localeCompare(b.videoId);
    });
  const progression =
    filters.sort === 'recommended' && filters.band === 'for_you' && profile.target >= 0
      ? blendDifficulty(sorted, profile)
      : sorted;
  // Interleave overrepresented creators/topics rather than silently discarding the rest.
  const diverse: Video[] =
    filters.sort === 'newest' || filters.sort === 'shortest' ? [...progression] : [];
  const remaining = diverse.length ? [] : [...progression];
  while (remaining.length) {
    const window = diverse.slice(-5);
    const index = remaining.findIndex(
      (v) =>
        window.filter((p) => p.channelId === v.channelId).length <
          (filters.diversity === 'wide' ? 1 : 2) &&
        (!v.topics[0] || window.filter((p) => p.topics[0] === v.topics[0]).length < 3),
    );
    diverse.push(remaining.splice(index < 0 ? 0 : index, 1)[0]);
  }
  return diverse.map((v) => ({ ...v, reason: explain(v, context, profile) }));
}
/** Verified-band availability for the current non-level filters. Public catalogue aggregates only. */
function coverage(videos: Video[], filters: Filters, region: string, now: number) {
  const unbanded = videos.filter((v) => eligible(v, { ...filters, band: 'all' }, region, now));
  const byBand = Object.fromEntries(BANDS.map((b) => [b[0], 0])) as Record<Band, number>;
  for (const v of unbanded) if (v.band) byBand[v.band]++;
  return {
    total: unbanded.length,
    verified: unbanded.filter((v) => v.band).length,
    prepared: unbanded.filter((v) => v.prepared).length,
    byBand,
  };
}
export async function buildFeed(
  videos: Video[],
  filters: Filters,
  context: Context,
  cursor: string | null,
  region = 'JP',
  now = Date.now(),
): Promise<Feed> {
  const epoch = Math.floor(now / 3600000) * 3600000;
  const version = await sha256(
    JSON.stringify([
      filters,
      context,
      region,
      epoch,
      videos.map((v) => [v.videoId, v.fetchedAt, v.proof, v.popularity, v.qualityScore ?? null]),
    ]),
  );
  let offset = 0;
  if (cursor) {
    try {
      if (cursor.length > 256) throw new Error();
      const decoded = JSON.parse(atob(cursor));
      if (
        decoded.version !== version ||
        !Number.isSafeInteger(decoded.offset) ||
        decoded.offset < 0 ||
        decoded.offset > 1000
      )
        throw new Error();
      offset = decoded.offset;
    } catch {
      throw new Error('Invalid or expired cursor');
    }
  }
  const candidates = videos.filter(
    (v) =>
      eligible(v, filters, region, now) && (filters.sort !== 'trending' || v.popularity !== null),
  );
  const ranked = rankVideos(candidates, filters, context, epoch);
  const laneSeen = new Set<string>();
  const target = bandIndex(context.suggestedBand);
  const lane = (key: string, title: string, predicate: (v: Card) => boolean) => {
    const items = ranked
      .filter(
        (v) =>
          !laneSeen.has(v.videoId) &&
          !context.saved.includes(v.videoId) &&
          !context.completed.includes(v.videoId) &&
          !context.seen.includes(v.videoId) &&
          predicate(v),
      )
      .slice(0, 3);
    items.forEach((v) => laneSeen.add(v.videoId));
    return { key, title, items };
  };
  const lanes =
    offset === 0 && filters.band === 'for_you' && !filters.q && filters.sort === 'recommended'
      ? [
          lane('recommended', 'Recommended for you', () => true),
          lane(
            'easy',
            'Easy listening',
            (v) => target >= 0 && !!v.band && bandIndex(v.band) < target,
          ),
          lane(
            'stretch',
            'A little stretch',
            (v) => target >= 0 && !!v.band && bandIndex(v.band) === target + 1,
          ),
          lane(
            'ready',
            'Ready to shadow now',
            (v) => v.prepared && filters.captions !== 'prepared',
          ),
          lane(
            'short',
            '5–10 minutes to yourself',
            (v) => v.durationSeconds >= 300 && v.durationSeconds <= 600,
          ),
          ...context.preferredTopics
            .slice(0, 2)
            .map((topic) =>
              lane(topic, `More ${TOPICS[topic].toLowerCase()}`, (v) => v.topics.includes(topic)),
            ),
          lane('new', 'New discoveries', (v) => epoch - Date.parse(v.indexedAt) < 7 * 86400000),
          lane('trending', 'Trending in Hibiki', (v) => v.popularity !== null),
        ].filter((l) => l.items.length)
      : [];
  const items = ranked.slice(offset, offset + 24);
  const hasMore = offset + 24 < ranked.length;
  return {
    items,
    lanes,
    total: ranked.length,
    hasMore,
    nextCursor: hasMore ? btoa(JSON.stringify({ offset: offset + 24, version })) : null,
    filters,
    suggestedBand: context.suggestedBand,
    catalogueUpdatedAt: videos.reduce<string | null>(
      (latest, v) => (!latest || v.fetchedAt > latest ? v.fetchedAt : latest),
      null,
    ),
    coverage: coverage(videos, filters, region, now),
  };
}
