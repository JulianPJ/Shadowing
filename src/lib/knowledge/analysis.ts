import type { Segment } from '../types';
import type { MorphologicalToken } from '../japanese-readings';
import { canonicalLemma } from '../lexicon/lookup';
import type { KnowledgeStates } from './types';

export function contentWord(token: MorphologicalToken) {
  return (
    ['名詞', '動詞', '形容詞', '副詞', '連体詞', '感動詞'].includes(token.pos ?? '') &&
    !['非自立', '接尾', '数'].includes(token.pos_detail_1 ?? '') &&
    /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token.surface_form) &&
    !!canonicalLemma(token)
  );
}
export type VocabularySection = {
  segmentId: string;
  known: number;
  learning: number;
  unknown: number;
  ignored: number;
  total: number;
  unknownLemmas: string[];
  oneUnknown: boolean;
  highValue: boolean;
  reason: string;
};
export type VocabularyAnalysis = {
  knownTokens: number;
  learningTokens: number;
  unknownTokens: number;
  ignoredTokens: number;
  totalTokens: number;
  knownPercent: number | null;
  trackedLemmas: number;
  uniqueLemmas: number;
  complete: boolean;
  analyzedSegments: number;
  segmentCount: number;
  sections: VocabularySection[];
};
export function analyzeVocabulary(
  segments: readonly Segment[],
  tokensBySegment: Record<string, readonly MorphologicalToken[]>,
  states: KnowledgeStates,
): VocabularyAnalysis {
  const occurrences = new Map<string, number>();
  const tracked = new Set<string>();
  const analyzed = segments.filter(
    (segment) =>
      tokensBySegment[segment.id]?.map((token) => token.surface_form).join('') === segment.japanese,
  );
  for (const segment of analyzed)
    for (const token of tokensBySegment[segment.id].filter(contentWord)) {
      const lemma = canonicalLemma(token);
      occurrences.set(lemma, (occurrences.get(lemma) ?? 0) + 1);
      if (states[lemma]) tracked.add(lemma);
    }
  const sections = analyzed.map((segment): VocabularySection => {
    let known = 0,
      learning = 0,
      unknown = 0,
      ignored = 0;
    const unknownLemmas = new Set<string>();
    for (const token of tokensBySegment[segment.id].filter(contentWord)) {
      const lemma = canonicalLemma(token),
        state = states[lemma]?.state ?? 'unknown';
      if (state === 'known') known++;
      else if (state === 'learning') learning++;
      else if (state === 'ignored') ignored++;
      else {
        unknown++;
        unknownLemmas.add(lemma);
      }
    }
    const total = known + learning + unknown;
    const clean =
      !segment.estimated &&
      Number.isFinite(segment.start) &&
      Number.isFinite(segment.end) &&
      segment.end - segment.start >= 2 &&
      segment.end - segment.start <= 12 &&
      segment.japanese.length <= 80 &&
      total >= 2;
    const oneUnknown = clean && unknownLemmas.size === 1 && learning === 0 && known >= 1;
    const recurrent = [...unknownLemmas].filter((lemma) => (occurrences.get(lemma) ?? 0) >= 2);
    const highValue =
      clean &&
      unknownLemmas.size >= 1 &&
      unknownLemmas.size <= 3 &&
      recurrent.length > 0 &&
      known / total >= 0.5;
    return {
      segmentId: segment.id,
      known,
      learning,
      unknown,
      ignored,
      total,
      unknownLemmas: [...unknownLemmas],
      oneUnknown,
      highValue,
      reason: oneUnknown
        ? `One Unknown word: ${[...unknownLemmas][0]}`
        : highValue
          ? `Recurring Unknown word${recurrent.length > 1 ? 's' : ''}: ${recurrent.join('、')}`
          : '',
    };
  });
  const sum = (key: 'known' | 'learning' | 'unknown' | 'ignored' | 'total') =>
    sections.reduce((value, section) => value + section[key], 0);
  const totalTokens = sum('total'),
    knownTokens = sum('known');
  return {
    knownTokens,
    learningTokens: sum('learning'),
    unknownTokens: sum('unknown'),
    ignoredTokens: sum('ignored'),
    totalTokens,
    knownPercent:
      totalTokens && analyzed.length === segments.length
        ? Math.round((knownTokens / totalTokens) * 100)
        : null,
    complete: analyzed.length === segments.length,
    analyzedSegments: analyzed.length,
    segmentCount: segments.length,
    trackedLemmas: tracked.size,
    uniqueLemmas: occurrences.size,
    sections,
  };
}
