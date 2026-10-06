import type { Segment } from './types';
import { hiragana, type MorphologicalToken } from './japanese-readings';

export const TOPIC_VOCABULARY_ALGORITHM_VERSION = 'topic-vocabulary-deterministic-v1';
export const TOPIC_VOCABULARY_THRESHOLD = 0.54;
export const TOPIC_VOCABULARY_LIMIT = 15;

const EXCLUDED_LEMMAS = new Set([
  'する',
  'ある',
  'いる',
  'なる',
  'できる',
  '言う',
  '思う',
  '見る',
  '行く',
  '来る',
  'これ',
  'それ',
  'あれ',
  'ここ',
  'そこ',
  'どこ',
  '何',
  '今日',
  '今',
  'そう',
  'よう',
  'こと',
  'もの',
  'ため',
  'ところ',
  'こちら',
  'どんな',
  '皆',
  'さん',
]);

const LOW_INFORMATION_LEMMAS = new Set([
  '人',
  '方',
  '時',
  '時間',
  '日',
  '年',
  '月',
  '中',
  '前',
  '後',
  '話',
  '場合',
  '問題',
  '自分',
]);

const JAPANESE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ヵヶ]/u;
const ONLY_KANA = /^[\p{Script=Hiragana}\p{Script=Katakana}ー]+$/u;

type CandidateKind = 'word' | 'compound';
type Occurrence = {
  segmentIndex: number;
  surface: string;
  reading?: string;
};
type Candidate = {
  term: string;
  kind: CandidateKind;
  specificity: number;
  occurrences: Occurrence[];
};
export type TopicVocabularyItem = {
  term: string;
  reading?: string;
  kind: CandidateKind;
  score: number;
  occurrences: number;
  sections: number;
  frequencyScore: number;
  dispersionScore: number;
  specificityScore: number;
  representativeSegmentId: string;
  representativeSegmentIndex: number;
  surfaceForms: string[];
};
export type TopicVocabularyAnalysis = {
  algorithmVersion: typeof TOPIC_VOCABULARY_ALGORITHM_VERSION;
  threshold: number;
  items: TopicVocabularyItem[];
};

function clamp(value: number) {
  return Math.max(0, Math.min(1, value));
}
function normalizeTerm(value: string) {
  return value.normalize('NFKC').trim();
}
function lemma(token: MorphologicalToken) {
  const basic = normalizeTerm(token.basic_form || '');
  return basic && basic !== '*' ? basic : normalizeTerm(token.surface_form);
}
function usefulTerm(term: string) {
  const length = Array.from(term).length;
  if (!term || length > 32 || !JAPANESE.test(term) || /^[\d０-９]+$/u.test(term)) return false;
  if (length === 1 && ONLY_KANA.test(term)) return false;
  return true;
}
function rejectedNounDetail(detail?: string) {
  return ['代名詞', '数', '非自立'].includes(detail || '');
}
function wordSpecificity(token: MorphologicalToken, term: string): number | null {
  if (EXCLUDED_LEMMAS.has(term)) return null;
  let value: number;
  if (token.pos === '名詞') {
    if (rejectedNounDetail(token.pos_detail_1)) return null;
    value = token.pos_detail_1 === '固有名詞' ? 0.78 : 0.9;
  } else if (token.pos === '動詞') value = 0.65;
  else if (token.pos === '形容詞') value = 0.7;
  else return null;
  if (LOW_INFORMATION_LEMMAS.has(term)) value *= 0.32;
  if (token.word_type === 'UNKNOWN') value *= 0.9;
  return value;
}
function readingFor(token: MorphologicalToken, term: string) {
  const raw = token.reading;
  if (!raw || raw === '*' || normalizeTerm(token.surface_form) !== term) return undefined;
  return hiragana(raw);
}
function nounCompoundPart(token: MorphologicalToken) {
  const term = lemma(token);
  return (
    token.pos === '名詞' &&
    !rejectedNounDetail(token.pos_detail_1) &&
    token.pos_detail_1 !== '接尾' &&
    !EXCLUDED_LEMMAS.has(term) &&
    usefulTerm(term)
  );
}
function addCandidate(
  candidates: Map<string, Candidate>,
  term: string,
  kind: CandidateKind,
  specificity: number,
  occurrence: Occurrence,
) {
  if (!usefulTerm(term)) return;
  const key = `${kind}:${term}`;
  const existing = candidates.get(key);
  if (existing) {
    existing.specificity = Math.max(existing.specificity, specificity);
    existing.occurrences.push(occurrence);
  } else candidates.set(key, { term, kind, specificity, occurrences: [occurrence] });
}
function segmentMidpoint(segment: Segment) {
  return segment.start + (segment.end - segment.start) / 2;
}
function dispersion(candidate: Candidate, segments: readonly Segment[]) {
  if (candidate.occurrences.length < 2 || !segments.length) return 0;
  const duration = Math.max(1, segments.at(-1)!.end - segments[0].start);
  const bucketCount = Math.min(6, Math.max(2, Math.ceil(segments.length / 4)));
  const points = candidate.occurrences.map(({ segmentIndex }) =>
    clamp((segmentMidpoint(segments[segmentIndex]) - segments[0].start) / duration),
  );
  const buckets = new Set(points.map((point) => Math.min(bucketCount - 1, Math.floor(point * bucketCount))));
  const bucketSpread = (buckets.size - 1) / Math.max(1, bucketCount - 1);
  const timelineSpan = Math.max(...points) - Math.min(...points);
  return clamp(bucketSpread * 0.6 + timelineSpan * 0.4);
}
function representative(candidate: Candidate, segments: readonly Segment[]) {
  const indexes = [...new Set(candidate.occurrences.map((occurrence) => occurrence.segmentIndex))];
  return indexes.sort((a, b) => {
    const left = segments[a],
      right = segments[b];
    const leftScore = (left.translation ? 0 : 1000) + Array.from(left.japanese).length;
    const rightScore = (right.translation ? 0 : 1000) + Array.from(right.japanese).length;
    return leftScore - rightScore || a - b;
  })[0];
}
function commonReading(candidate: Candidate) {
  const counts = new Map<string, number>();
  for (const occurrence of candidate.occurrences)
    if (occurrence.reading)
      counts.set(occurrence.reading, (counts.get(occurrence.reading) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
}
function surfaceForms(candidate: Candidate) {
  const counts = new Map<string, number>();
  for (const occurrence of candidate.occurrences)
    counts.set(occurrence.surface, (counts.get(occurrence.surface) || 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'))
    .slice(0, 4)
    .map(([surface]) => surface);
}

export function rankTopicVocabulary(
  segments: readonly Segment[],
  analyzed: readonly (readonly MorphologicalToken[])[],
  options: { threshold?: number; maxItems?: number } = {},
): TopicVocabularyAnalysis {
  if (segments.length !== analyzed.length) throw new Error('Topic vocabulary tokenization mismatch.');
  const candidates = new Map<string, Candidate>();

  analyzed.forEach((tokens, segmentIndex) => {
    tokens.forEach((token) => {
      const term = lemma(token);
      const specificity = wordSpecificity(token, term);
      if (specificity !== null && usefulTerm(term))
        addCandidate(candidates, term, 'word', specificity, {
          segmentIndex,
          surface: normalizeTerm(token.surface_form),
          reading: readingFor(token, term),
        });
    });

    for (let start = 0; start < tokens.length; start++) {
      if (!nounCompoundPart(tokens[start])) continue;
      for (let size = 2; size <= 3 && start + size <= tokens.length; size++) {
        const parts = tokens.slice(start, start + size);
        if (!parts.every(nounCompoundPart)) break;
        const term = parts.map((part) => normalizeTerm(part.surface_form)).join('');
        const compoundReading = parts.every((part) => part.reading && part.reading !== '*')
          ? hiragana(parts.map((part) => part.reading).join(''))
          : undefined;
        addCandidate(candidates, term, 'compound', 1, {
          segmentIndex,
          surface: term,
          reading: compoundReading,
        });
      }
    }
  });

  const threshold = options.threshold ?? TOPIC_VOCABULARY_THRESHOLD;
  const maxItems = options.maxItems ?? TOPIC_VOCABULARY_LIMIT;
  const scored = [...candidates.values()].map((candidate): TopicVocabularyItem => {
    const count = candidate.occurrences.length;
    const frequencyScore = clamp(Math.log1p(count) / Math.log(6));
    const dispersionScore = dispersion(candidate, segments);
    const specificityScore = clamp(candidate.specificity);
    const score = clamp(
      frequencyScore * 0.45 +
        dispersionScore * 0.2 +
        specificityScore * 0.35 +
        (candidate.kind === 'compound' ? 0.05 : 0),
    );
    const representativeSegmentIndex = representative(candidate, segments);
    return {
      term: candidate.term,
      reading: commonReading(candidate),
      kind: candidate.kind,
      score: Number(score.toFixed(3)),
      occurrences: count,
      sections: new Set(candidate.occurrences.map((occurrence) => occurrence.segmentIndex)).size,
      frequencyScore: Number(frequencyScore.toFixed(3)),
      dispersionScore: Number(dispersionScore.toFixed(3)),
      specificityScore: Number(specificityScore.toFixed(3)),
      representativeSegmentId: segments[representativeSegmentIndex].id,
      representativeSegmentIndex,
      surfaceForms: surfaceForms(candidate),
    };
  });

  const eligible = scored
    .filter((item) => item.score >= threshold)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.occurrences - a.occurrences ||
        b.term.length - a.term.length ||
        a.term.localeCompare(b.term, 'ja'),
    );

  const withoutRedundantWords = eligible.filter((item) => {
    if (item.kind !== 'word') return true;
    return !eligible.some(
      (other) =>
        other.kind === 'compound' &&
        other.term !== item.term &&
        other.term.includes(item.term) &&
        other.occurrences >= item.occurrences &&
        other.score >= item.score - 0.08,
    );
  });

  const uniqueTerms = new Map<string, TopicVocabularyItem>();
  for (const item of withoutRedundantWords) {
    const existing = uniqueTerms.get(item.term);
    if (!existing || item.score > existing.score || (item.kind === 'compound' && existing.kind === 'word'))
      uniqueTerms.set(item.term, item);
  }

  return {
    algorithmVersion: TOPIC_VOCABULARY_ALGORITHM_VERSION,
    threshold,
    items: [...uniqueTerms.values()]
      .sort(
        (a, b) =>
          b.score - a.score ||
          b.occurrences - a.occurrences ||
          b.term.length - a.term.length ||
          a.term.localeCompare(b.term, 'ja'),
      )
      .slice(0, Math.max(0, maxItems)),
  };
}
