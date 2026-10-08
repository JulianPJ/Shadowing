import type { MorphologicalToken } from './japanese-readings';

/** Exact display offsets, shared by lookup, readings and knowledge highlighting. */
export type JapaneseLexicalSpan = {
  text: string;
  start: number;
  end: number;
  lemma: string;
  tokens: readonly MorphologicalToken[];
  wordLike: boolean;
};

const lemmaOf = (token: MorphologicalToken) =>
  (token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form)
    .normalize('NFC')
    .trim();

function followsPredicate(tokens: readonly MorphologicalToken[], index: number) {
  const token = tokens[index];
  if (token.pos === '助動詞') return true;
  if (['動詞', '形容詞'].includes(token.pos ?? '') && token.pos_detail_1 === '非自立') return true;
  // Connect progressive/completive forms, without swallowing case/topic particles.
  return (
    token.pos === '助詞' &&
    token.pos_detail_1 === '接続助詞' &&
    ['て', 'で'].includes(token.surface_form) &&
    tokens[index + 1]?.pos === '動詞' &&
    tokens[index + 1]?.pos_detail_1 === '非自立'
  );
}

export function japaneseLexicalSpans(
  text: string,
  analyzed?: readonly MorphologicalToken[],
): JapaneseLexicalSpan[] {
  const valid = analyzed?.length && analyzed.map((token) => token.surface_form).join('') === text;
  if (!valid) {
    // Immediate, exact fallback while the local dictionary loads. Conservative suffix
    // joining avoids the default Segmenter's 話 / せ / ます targets.
    const parts = Array.from(new Intl.Segmenter('ja', { granularity: 'word' }).segment(text));
    const spans: JapaneseLexicalSpan[] = [];
    for (const part of parts) {
      const previous = spans.at(-1);
      if (
        previous?.wordLike &&
        /[\p{Script=Han}]/u.test(previous.text) &&
        part.isWordLike &&
        /^(?:せ|さ|ます|まし|ませ|ません|た|ない|なかっ|れる|られる|ました|ませんでした)$/u.test(
          part.segment,
        )
      ) {
        previous.text += part.segment;
        previous.end += part.segment.length;
        previous.lemma = previous.text;
      } else {
        spans.push({
          text: part.segment,
          start: part.index,
          end: part.index + part.segment.length,
          lemma: part.segment,
          tokens: [],
          wordLike: !!part.isWordLike,
        });
      }
    }
    return spans;
  }
  const spans: JapaneseLexicalSpan[] = [];
  let offset = 0;
  for (let index = 0; index < analyzed.length; index++) {
    const stem = analyzed[index];
    const first = index;
    const verbalNoun =
      stem.pos === '名詞' &&
      stem.pos_detail_1 === 'サ変接続' &&
      lemmaOf(analyzed[index + 1] ?? { surface_form: '' }) === 'する';
    const predicate =
      ['動詞', '形容詞'].includes(stem.pos ?? '') ||
      (stem.pos === '名詞' && stem.pos_detail_1 === '形容動詞語幹') ||
      verbalNoun;
    if (verbalNoun) index++;
    if (predicate) {
      while (index + 1 < analyzed.length && followsPredicate(analyzed, index + 1)) index++;
    } else if (stem.pos === '名詞') {
      while (analyzed[index + 1]?.pos === '名詞' && analyzed[index + 1]?.pos_detail_1 === '接尾')
        index++;
    }
    const tokens = analyzed.slice(first, index + 1);
    const surface = tokens.map((token) => token.surface_form).join('');
    spans.push({
      text: surface,
      start: offset,
      end: offset + surface.length,
      lemma: lemmaOf(stem),
      tokens,
      wordLike: /[\p{L}\p{N}]/u.test(surface),
    });
    offset += surface.length;
  }
  return spans;
}

/** Resolve a selected inflected form against its original sentence before re-analysis. */
export function selectedMorphology(
  selected: string,
  tokens: readonly MorphologicalToken[],
): readonly MorphologicalToken[] {
  for (let start = 0; start < tokens.length; start++) {
    let surface = '';
    for (let end = start; end < tokens.length; end++) {
      surface += tokens[end].surface_form;
      if (surface === selected) return tokens.slice(start, end + 1);
      if (!selected.startsWith(surface)) break;
    }
  }
  return [];
}
