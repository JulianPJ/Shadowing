import { BANDS, TOPICS, type Context, type Topic, type Video } from './types';
import { levelSource } from './declared-level';

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
/** Signed band distance from the learner's level, or null when either is unknown. */
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

  // Difficulty fit. A creator's label counts for less than an analysed transcript, and a level
  // inferred from the channel's other videos for less again. Search intent is never a level.
  let difficulty = 0;
  const distance = bandDistance(v, profile);
  // One band either side is comfortable or a stretch. Further away stays reachable through the
  // level filters but is not a default pick: much harder discourages, much easier bores.
  const FIT: Record<string, number> = { '-1': 14, '0': 20, '1': 12 };
  if (distance !== null)
    difficulty = (FIT[distance] ?? (distance < 0 ? -3 : -10)) * EVIDENCE_WEIGHT[levelSource(v)!];

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
const EVIDENCE_WEIGHT = { transcript: 1, creator: 0.8, channel: 0.6 } as const;
export const totalScore = (parts: ScoreParts) =>
  parts.quality + parts.difficulty + parts.interest + parts.history + parts.exploration;

/** One honest sentence. Each level is named with its evidence: an estimate or a label. */
export function explain(v: Video, context: Context, profile: Profile): string {
  const fit = context.vocabularyFit[v.videoId];
  if (fit !== undefined) return `${fit}% of content words explicitly marked Known on this device`;
  const distance = bandDistance(v, profile);
  const band = v.band ? BANDS.find((b) => b[0] === v.band)![1] : null;
  const source = levelSource(v);
  const level =
    source === 'creator'
      ? `Labelled ${band} by the creator`
      : source === 'channel'
        ? `Usually ${band} on this channel`
        : `Estimated ${band}`;
  if (distance === 0) return `${level}, close to your level`;
  if (distance === -1) return `${level}: an easier, comfortable listen`;
  if (distance === 1) return `${level}: a little above your level`;
  const topic = v.topics.find(
    (t) => context.preferredTopics.includes(t) || profile.likedTopics.has(t),
  );
  if (topic) return `More ${TOPICS[topic].toLowerCase()} videos`;
  if (profile.likedChannels.has(v.channelId)) return `More from ${v.channelTitle}`;
  if (v.prepared) return 'Japanese captions already prepared in Hibiki';
  if (v.audience === 'learner') return 'Made for Japanese learners';
  if (v.durationSeconds <= 600) return 'A shorter session';
  if (v.languageEvidence === 'reported-japanese-audio') return 'Spoken Japanese, newly found';
  return 'A new Japanese listening possibility';
}
