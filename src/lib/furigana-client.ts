import {
  annotateJapanese,
  hasKanji,
  type JapaneseReadingToken,
  type MorphologicalToken,
} from './japanese-readings';
import {
  analyzeJapanese,
  type JapaneseAnalysis,
  type JapaneseAnalysisOptions,
} from './japanese-analysis';

// Preserve the public views and promise reuse while sharing their one morphology request.
const readingViews = new WeakMap<
  Promise<JapaneseAnalysis>,
  Promise<readonly JapaneseReadingToken[]>
>();
const morphologyViews = new WeakMap<
  Promise<JapaneseAnalysis>,
  Promise<readonly MorphologicalToken[]>
>();

export function japaneseReadings(
  text: string,
  options?: JapaneseAnalysisOptions,
): Promise<readonly JapaneseReadingToken[]> {
  if (!hasKanji(text)) return Promise.resolve([{ text }]);
  const analysis = analyzeJapanese(text, options);
  let readings = readingViews.get(analysis);
  if (!readings) {
    readings = analysis.then(
      ({ tokens }) => annotateJapanese(text, tokens),
      (error: Error) => {
        if (options?.signal?.aborted) throw error;
        throw new Error('Readings unavailable');
      },
    );
    readingViews.set(analysis, readings);
  }
  return readings;
}

export function japaneseMorphology(
  text: string,
  options?: JapaneseAnalysisOptions,
): Promise<readonly MorphologicalToken[]> {
  const analysis = analyzeJapanese(text, options);
  let tokens = morphologyViews.get(analysis);
  if (!tokens) {
    tokens = analysis.then((result) => result.tokens);
    morphologyViews.set(analysis, tokens);
  }
  return tokens;
}
