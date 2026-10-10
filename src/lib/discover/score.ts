import { BANDS, TOPICS, type Band, type Context, type Topic, type Video } from './types';
import type { LevelTarget } from './acquisition';

/**
 * Transparent recommendation scoring. Each part is a small, bounded number so no single signal
 * dominates, and the strongest contributing part provides the card's explanation.
 */
export type ScoreParts = {
  quality: number;
  difficulty: number;
  interest: number;
  history: number;
  exploration: number;
};
export type Profile = {
  target: number;
  likedTopics: Set<Topic>;
  familiarTopics: Set<Topic>;
  likedChannels: Set<string>;
  familiarChannels: Set<string>;
};
export const bandIndex = (band: string | null | undefined) => BANDS.findIndex((b) => b[0] === band);
/** The acquisition intent closest to a band. Used only for unverified videos. */
export function levelForBand(band: Band | null): LevelTarget | null {
  const index = bandIndex(band);
  return index < 0 ? null : index <= 1 ? 'beginner' : index <= 3 ? 'intermediate' : 'advanced';
}
export function learnerProfile(videos: Video[], context: Context): Profile {
  const liked = videos.filter((v) => context.liked.includes(v.videoId));
  const familiar = videos.filter(
    (v) => context.completed.includes(v.videoId) || context.saved.includes(v.videoId),
  );
  return {
    target: bandIndex(context.suggestedBand),
    likedTopics: new Set(liked.flatMap((v) => v.topics)),
    familiarTopics: new Set(familiar.flatMap((v) => v.topics)),
    likedChannels: new Set(liked.map((v) => v.channelId)),
    familiarChannels: new Set([...liked, ...familiar].map((v) => v.channelId)),
  };
}
/** Signed verified-band distance from the learner's level, or null when either is unknown. */
export function bandDistance(video: Video, profile: Profile) {
  return profile.target >= 0 && video.band ? bandIndex(video.band) - profile.target : null;
}
export function scoreParts(v: Video, context: Context, profile: Profile, now: number): ScoreParts {
  // Usefulness for shadowing: metadata quality, speech evidence and preparation outcomes.
  let quality = v.qualityScore != null ? Math.min(8, Math.max(0, (v.qualityScore - 55) / 4)) : 2;
  quality +=
    v.languageEvidence === 'reported-japanese-audio'
      ? 2
      : v.languageEvidence === 'japanese-metadata'
        ? 1
        : 0;
  if (v.prepared) quality += 6;
  else if (v.captionFlag) quality += 1;
  // Known caption problems stay visible but stop leading the feed.
  if (v.preparationStatus === 'needs-captions') quality -= 5;
  if (v.preparationStatus === 'failed') quality -= 3;

  // Difficulty fit: verified bands only. Search intent is a weak hint for unverified videos.
  let difficulty = 0;
  const distance = bandDistance(v, profile);
  // One band either side is comfortable or a stretch. Further away stays reachable through the
  // level filters but is not a default pick: much harder discourages, much easier bores.
  const FIT: Record<string, number> = { '-1': 14, '0': 20, '1': 12 };
  if (distance !== null) difficulty = FIT[distance] ?? (distance < 0 ? -3 : -10);
  else if (profile.target >= 0 && !v.band) {
    const level = levelForBand(BANDS[profile.target][0]);
    if (level && v.levelTargets?.includes(level)) difficulty = 4;
  }

  let interest = 0;
  if (context.preferredTopics.some((t) => v.topics.includes(t))) interest += 12;
  if (v.topics.some((t) => profile.likedTopics.has(t))) interest += 8;
  if (profile.likedChannels.has(v.channelId)) interest += 4;
  if (v.topics.some((t) => profile.familiarTopics.has(t))) interest += 5;
  if (context.comfortableSeconds)
    interest += Math.max(0, 5 - Math.abs(v.durationSeconds - context.comfortableSeconds) / 180);
  if (context.vocabularyFit[v.videoId] !== undefined)
    interest += context.vocabularyFit[v.videoId] / 10;

  let history = 0;
  if (context.saved.includes(v.videoId)) history -= 15;
  if (context.completed.includes(v.videoId)) history -= 25;
  if (context.seen.includes(v.videoId)) history -= 4;

  // Freshness and gentle exposure for creators the learner has not met yet.
  let exploration = Math.max(0, 3 - (now - Date.parse(v.indexedAt)) / 86400000 / 7);
  if (profile.familiarChannels.size && !profile.familiarChannels.has(v.channelId)) exploration += 1;
  return { quality, difficulty, interest, history, exploration };
}
export const totalScore = (parts: ScoreParts) =>
  parts.quality + parts.difficulty + parts.interest + parts.history + parts.exploration;

const LEVEL_NAMES: Record<LevelTarget, string> = {
  beginner: 'beginner',
  intermediate: 'intermediate',
  advanced: 'advanced',
};
/** One honest sentence. Verified levels are named as estimates; search intent is named as such. */
export function explain(v: Video, context: Context, profile: Profile): string {
  const fit = context.vocabularyFit[v.videoId];
  if (fit !== undefined) return `${fit}% of content words explicitly marked Known on this device`;
  const distance = bandDistance(v, profile);
  const band = v.band ? BANDS.find((b) => b[0] === v.band)![1] : null;
  if (distance === 0) return `Estimated ${band}, close to your level`;
  if (distance === -1) return `Estimated ${band}: an easier, comfortable listen`;
  if (distance === 1) return `Estimated ${band}: a little above your level`;
  const topic = v.topics.find(
    (t) => context.preferredTopics.includes(t) || profile.likedTopics.has(t),
  );
  if (topic) return `More ${TOPICS[topic].toLowerCase()} videos`;
  if (profile.likedChannels.has(v.channelId)) return `More from ${v.channelTitle}`;
  if (v.prepared) return 'Japanese captions already prepared in Hibiki';
  const level = profile.target >= 0 ? levelForBand(BANDS[profile.target][0]) : null;
  if (!v.band && level && v.levelTargets?.includes(level))
    return `Found by a search for ${LEVEL_NAMES[level]} listening · level not yet estimated`;
  if (v.audience === 'learner') return 'Made for Japanese learners';
  if (v.durationSeconds <= 600) return 'A shorter session';
  if (v.languageEvidence === 'reported-japanese-audio') return 'Spoken Japanese, newly found';
  return 'A new Japanese listening possibility';
}
