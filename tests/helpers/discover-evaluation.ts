import { assessQuality, type Quality } from '../../src/lib/discover/quality';
import { buildFeed } from '../../src/lib/discover/rank';
import { DEFAULT_FILTERS, EMPTY_CONTEXT, type Video } from '../../src/lib/discover/types';
import { LEVEL_TARGETS } from '../../src/lib/discover/acquisition';
import {
  allCandidates,
  baselineCandidates,
  matrixCandidates,
  type Candidate,
} from '../fixtures/discover-candidates';
import { discoveryNow, discoveryVideo } from './discover';

export type Assessed = Candidate & { quality: Quality };
export const assess = (candidates: Candidate[]): Assessed[] =>
  candidates.map((c) => ({ ...c, quality: assessQuality(c, { prepared: c.prepared }) }));

function selection(label: string, accepted: Candidate[], universe: Candidate[]) {
  const relevant = universe.filter((c) => c.relevant).length;
  const hits = accepted.filter((c) => c.relevant).length;
  return {
    label,
    candidates: universe.length,
    accepted: accepted.length,
    relevantAccepted: hits,
    precision: accepted.length ? hits / accepted.length : 0,
    recall: relevant ? hits / relevant : 0,
  };
}
export function toVideo(candidate: Candidate, index: number, quality?: Quality): Video {
  return discoveryVideo(index, {
    videoId: candidate.id.padEnd(11, '0').slice(0, 11),
    title: candidate.title,
    channelId: candidate.channelId,
    channelTitle: candidate.channelTitle,
    description: candidate.description,
    durationSeconds: candidate.durationSeconds,
    captionFlag: candidate.captionFlag,
    topics: candidate.topic ? [candidate.topic] : [],
    prepared: !!candidate.prepared,
    qualityScore: quality?.score ?? null,
    languageEvidence: quality?.languageEvidence ?? null,
    levelTargets: candidate.levelTarget ? [candidate.levelTarget] : [],
    // Spread over the week so freshness does not decide the order.
    indexedAt: new Date(discoveryNow - (index % 7) * 86400000).toISOString(),
  });
}
async function feedPrecision(videos: Video[], relevantIds: Set<string>) {
  const feed = await buildFeed(videos, DEFAULT_FILTERS, EMPTY_CONTEXT, null, 'JP', discoveryNow);
  const at = (k: number) => {
    const top = feed.items.slice(0, k);
    return top.length ? top.filter((v) => relevantIds.has(v.videoId)).length / k : 0;
  };
  const top24 = feed.items.slice(0, 24);
  const channels = new Set(top24.map((v) => v.channelId)).size;
  return { p10: at(10), p24: at(24), channelsInTop24: channels, items: feed.total };
}
/** Before = every provider result catalogued. After = quality-assessed acquisition. */
export async function evaluateDiscover() {
  const assessed = assess(allCandidates);
  const accepted = assessed.filter((c) => c.quality.accepted);
  const reasons: Record<string, number> = {};
  for (const c of assessed)
    if (c.quality.rejection) reasons[c.quality.rejection] = (reasons[c.quality.rejection] ?? 0) + 1;
  const falsePositives = accepted.filter((c) => !c.relevant).map((c) => c.title);
  const falseNegatives = assessed
    .filter((c) => c.relevant && !c.quality.accepted)
    .map((c) => `${c.title} (${c.quality.rejection})`);
  const levelCoverage = Object.fromEntries(
    LEVEL_TARGETS.map((level) => [
      level,
      accepted.filter((c) => c.levelTarget === level && c.relevant).length,
    ]),
  );
  const evidence: Record<string, number> = {};
  for (const c of accepted)
    evidence[c.quality.languageEvidence] = (evidence[c.quality.languageEvidence] ?? 0) + 1;
  const relevantIds = new Set(
    allCandidates.filter((c) => c.relevant).map((c, i) => toVideo(c, i).videoId),
  );
  const beforeCatalogue = baselineCandidates.map((c, i) => toVideo(c, i));
  const afterCatalogue = accepted.map((c, i) => toVideo(c, i, c.quality));
  return {
    catalogue: [
      selection('Production baseline, before', baselineCandidates, baselineCandidates),
      selection(
        'Production baseline, after',
        accepted.filter((c) => c.set === 'baseline'),
        baselineCandidates,
      ),
      selection('Level-targeted searches, unfiltered', matrixCandidates, matrixCandidates),
      selection(
        'Level-targeted searches, after',
        accepted.filter((c) => c.set === 'matrix'),
        matrixCandidates,
      ),
    ],
    rejectionReasons: reasons,
    falsePositives,
    falseNegatives,
    levelTargetCoverage: levelCoverage,
    languageEvidence: evidence,
    captionsReportedAccepted: accepted.filter((c) => c.captionFlag).length,
    feed: {
      before: await feedPrecision(beforeCatalogue, relevantIds),
      after: await feedPrecision(afterCatalogue, relevantIds),
    },
  };
}
