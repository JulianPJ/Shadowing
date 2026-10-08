import { sha256 } from '../hash';
import {
  BANDS,
  TOPICS,
  type Card,
  type Context,
  type Feed,
  type Filters,
  type Video,
} from './types';
import { eligible } from './eligibility';
const bandIndex = (band: string | null) => BANDS.findIndex((b) => b[0] === band);
export function rankVideos(
  videos: Video[],
  filters: Filters,
  context: Context,
  now: number,
): Card[] {
  const target = bandIndex(context.suggestedBand);
  const likedTopics = new Set(
    videos.filter((v) => context.liked.includes(v.videoId)).flatMap((v) => v.topics),
  );
  const familiarTopics = new Set(
    videos
      .filter((p) => context.completed.includes(p.videoId) || context.saved.includes(p.videoId))
      .flatMap((p) => p.topics),
  );
  const score = (v: Video) => {
    let value = v.prepared ? 4 : 0;
    if (target >= 0 && v.band) value += Math.max(0, 20 - 8 * Math.abs(bandIndex(v.band) - target));
    if (context.preferredTopics.some((t) => v.topics.includes(t))) value += 12;
    if (v.topics.some((t) => likedTopics.has(t))) value += 8;
    if (v.topics.some((t) => familiarTopics.has(t))) value += 5;
    if (context.comfortableSeconds)
      value += Math.max(0, 5 - Math.abs(v.durationSeconds - context.comfortableSeconds) / 180);
    if (context.vocabularyFit[v.videoId] !== undefined)
      value += context.vocabularyFit[v.videoId] / 10;
    value += Math.max(0, 3 - (now - Date.parse(v.indexedAt)) / 86400000 / 7);
    if (context.saved.includes(v.videoId)) value -= 15;
    if (context.completed.includes(v.videoId)) value -= 25;
    if (context.seen.includes(v.videoId)) value -= 4;
    return value;
  };
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
              : score(b) - score(a);
      return order || b.indexedAt.localeCompare(a.indexedAt) || a.videoId.localeCompare(b.videoId);
    });
  // Interleave overrepresented creators/topics rather than silently discarding the rest.
  const diverse: Video[] =
    filters.sort === 'newest' || filters.sort === 'shortest' ? [...sorted] : [];
  const remaining = diverse.length ? [] : [...sorted];
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
  return diverse.map((v) => {
    const topic = v.topics.find((t) => context.preferredTopics.includes(t) || likedTopics.has(t));
    const reason =
      context.vocabularyFit[v.videoId] !== undefined
        ? `${context.vocabularyFit[v.videoId]}% of content words explicitly marked Known on this device`
        : topic
          ? `More ${TOPICS[topic].toLowerCase()} videos`
          : target >= 0 && v.band && bandIndex(v.band) === target
            ? 'Close to the content you usually practise'
            : target >= 0 && v.band && bandIndex(v.band) === target + 1
              ? 'A little above your usual content band'
              : v.durationSeconds <= 600
                ? 'A shorter session'
                : v.prepared
                  ? 'Japanese captions already prepared in Hibiki'
                  : 'A new Japanese listening possibility';
    return { ...v, reason };
  });
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
      videos.map((v) => [v.videoId, v.fetchedAt, v.proof, v.popularity]),
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
  };
}
