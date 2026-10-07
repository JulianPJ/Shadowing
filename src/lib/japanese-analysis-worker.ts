import { annotateJapanese, type MorphologicalToken } from './japanese-readings';
import {
  JAPANESE_BATCH_MAX_CHARACTERS,
  JAPANESE_BATCH_MAX_ITEMS,
  type JapaneseWorkerRequest,
} from './japanese-analysis-protocol';

export type JapaneseTokenizer = { tokenize: (text: string) => MorphologicalToken[] };

function safeMorphology(token: MorphologicalToken): MorphologicalToken {
  return {
    surface_form: token.surface_form,
    ...(token.reading ? { reading: token.reading } : {}),
    ...(token.word_type ? { word_type: token.word_type } : {}),
    ...(token.basic_form ? { basic_form: token.basic_form } : {}),
    ...(token.pos ? { pos: token.pos } : {}),
    ...(token.pos_detail_1 ? { pos_detail_1: token.pos_detail_1 } : {}),
    ...(token.pos_detail_2 ? { pos_detail_2: token.pos_detail_2 } : {}),
    ...(token.pos_detail_3 ? { pos_detail_3: token.pos_detail_3 } : {}),
    ...(token.conjugated_type ? { conjugated_type: token.conjugated_type } : {}),
    ...(token.conjugated_form ? { conjugated_form: token.conjugated_form } : {}),
    ...(token.pronunciation ? { pronunciation: token.pronunciation } : {}),
  };
}

/** The legacy readings/morphology messages remain supported by the same engine. */
export async function runJapaneseWorkerRequest(
  request: JapaneseWorkerRequest,
  loadTokenizer: () => Promise<JapaneseTokenizer>,
) {
  const { id, kind = 'readings' } = request;
  try {
    if (request.kind === 'morphology-batch') {
      const { items } = request;
      if (
        !Array.isArray(items) ||
        items.length === 0 ||
        items.length > JAPANESE_BATCH_MAX_ITEMS ||
        items.some((item) => typeof item.id !== 'number' || typeof item.text !== 'string') ||
        new Set(items.map((item) => item.id)).size !== items.length ||
        (items.length > 1 &&
          items.reduce((sum, item) => sum + item.text.length, 0) > JAPANESE_BATCH_MAX_CHARACTERS)
      )
        throw new Error('Invalid Japanese analysis batch');
      const parser = await loadTokenizer();
      return {
        id,
        kind,
        results: items.map((item) => ({
          id: item.id,
          tokens: parser.tokenize(item.text).map(safeMorphology),
        })),
      };
    }
    const parser = await loadTokenizer();
    const analyzed = parser.tokenize(request.text);
    return {
      id,
      kind,
      tokens:
        kind === 'morphology'
          ? analyzed.map(safeMorphology)
          : annotateJapanese(request.text, analyzed),
    };
  } catch {
    return { id, kind, error: true };
  }
}
