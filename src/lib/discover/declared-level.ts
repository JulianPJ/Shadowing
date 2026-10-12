import { bandFromRange, type Band, type Video } from './types';

/**
 * Levels a creator states in a video's metadata, such as "N5–N4", "N3・N2", "(N2-3)" or
 * "【N4】". Learners pick content by these labels, so they are a stronger signal than the search
 * that found the video, but they are the creator's claim: cards name them as such, and a full
 * transcript analysis always replaces them.
 */
export type LevelSource = 'transcript' | 'creator' | 'channel';

const LEVEL = /(?<![A-Za-z0-9])N\s?([1-5])(?![0-9])/gi;
// "N2-3" and "N5~4" shorthand: the second level has no N of its own.
const SHORTHAND = /(?<![A-Za-z0-9])N\s?([1-5])\s*[-–—~〜・/]\s*([1-5])(?![0-9])/gi;

/** JLPT levels named in the text, as numbers (5 = N5). */
export function namedLevels(text: string): number[] {
  const normalized = text.normalize('NFKC'),
    levels = new Set<number>();
  for (const match of normalized.matchAll(LEVEL)) levels.add(Number(match[1]));
  for (const match of normalized.matchAll(SHORTHAND)) {
    levels.add(Number(match[1]));
    levels.add(Number(match[2]));
  }
  return [...levels];
}

/**
 * The band covering the named levels. A single level maps to the band that ends at it ("N4"
 * material is N5–N4); a span of up to three adjacent levels maps to the band ending at its
 * hardest level. Wider spans ("N5–N1") say nothing about this video and are ignored.
 */
export function bandForLevels(levels: number[]): Band | null {
  if (!levels.length) return null;
  const easiest = Math.max(...levels),
    hardest = Math.min(...levels);
  if (easiest - hardest > 2) return null;
  if (hardest === 5) return 'n5_plus';
  return bandFromRange(`N${hardest + 1}`, `N${hardest}`);
}

const LEVEL_WORDS: [RegExp, Band][] = [
  [/超初級|入門|absolute\s+beginners?/i, 'n5_plus'],
  [/初中級|(?:lower|pre)[-\s]?intermediate/i, 'n4_n3'],
  [/中上級|upper[-\s]?intermediate/i, 'n2_n1'],
  [/初級|beginners?/i, 'n5_n4'],
  [/中級|intermediate/i, 'n3_n2'],
  [/上級|advanced/i, 'n2_n1'],
];
/** One unambiguous level word; "beginner to advanced" names several and is ignored. */
function wordBand(text: string): Band | null {
  let rest = text.normalize('NFKC');
  const found = new Set<Band>();
  for (const [pattern, band] of LEVEL_WORDS) {
    if (pattern.test(rest)) found.add(band);
    // Remove matched words so 初級 does not also count inside 初中級.
    rest = rest.replace(new RegExp(pattern.source, 'gi'), ' ');
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The creator's stated level. Titles are trusted on their own; descriptions and level words only
 * for learner-oriented videos, because channels advertise course ranges ("N3–N1") and words such
 * as 入門 also appear in unrelated native titles. Description ranges must be narrow.
 */
export function declaredBand(title: string, description: string, learner: boolean): Band | null {
  const fromTitle = bandForLevels(namedLevels(title));
  if (fromTitle) return fromTitle;
  // A title naming JLPT levels too far apart to place stays unplaced; do not guess from elsewhere.
  if (namedLevels(title).length) return null;
  if (!learner) return null;
  const words = wordBand(title);
  if (words) return words;
  const levels = namedLevels(description);
  return levels.length && Math.max(...levels) - Math.min(...levels) <= 1
    ? bandForLevels(levels)
    : null;
}

/**
 * Unplaced videos inherit their channel's level when at least two of its other videos are placed
 * and at least 80% of those agree. Channels that teach at one level label most uploads, so this
 * extends their labels to the few they leave out.
 */
export function withChannelLevels(videos: Video[]): Video[] {
  const counts = new Map<string, Map<Band, number>>();
  for (const v of videos)
    if (v.band && v.levelSource !== 'channel') {
      const bands = counts.get(v.channelId) ?? new Map<Band, number>();
      bands.set(v.band, (bands.get(v.band) ?? 0) + 1);
      counts.set(v.channelId, bands);
    }
  const consensus = new Map<string, Band>();
  for (const [channel, bands] of counts) {
    const total = [...bands.values()].reduce((sum, n) => sum + n, 0);
    const [band, n] = [...bands.entries()].sort((a, b) => b[1] - a[1])[0];
    if (total >= 2 && n / total >= 0.8) consensus.set(channel, band);
  }
  return videos.map((v) =>
    !v.band && consensus.has(v.channelId)
      ? { ...v, band: consensus.get(v.channelId)!, levelSource: 'channel' }
      : v,
  );
}

/** Where a placed video's level comes from. Videos without a recorded source were analysed. */
export const levelSource = (v: Pick<Video, 'band' | 'levelSource'>): LevelSource | null =>
  v.band ? (v.levelSource ?? 'transcript') : null;
