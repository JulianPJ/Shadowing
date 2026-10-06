import type { MorphologicalToken } from '../japanese-readings';
import { hiragana } from '../japanese-readings';
import type { LexicalMatch, LexiconEntry } from './types';

export function canonicalLemma(token: MorphologicalToken) {
  return (token.basic_form && token.basic_form !== '*' ? token.basic_form : token.surface_form)
    .normalize('NFC')
    .trim();
}
export function lookupCandidates(selected: string, tokens: readonly MorphologicalToken[]) {
  const term = selected.normalize('NFC').trim();
  const exact = tokens.find((token) => token.surface_form === term);
  const whole = tokens.map((token) => token.surface_form).join('') === term;
  const stem = tokens[0];
  const inflection =
    whole &&
    stem &&
    ['動詞', '形容詞'].includes(stem.pos ?? '') &&
    tokens
      .slice(1)
      .every(
        (token) =>
          ['助動詞', '助詞'].includes(token.pos ?? '') ||
          (['動詞', '形容詞'].includes(token.pos ?? '') && token.pos_detail_1 === '非自立'),
      );
  const verbalNoun =
    whole &&
    stem?.pos === '名詞' &&
    stem.pos_detail_1 === 'サ変接続' &&
    canonicalLemma(tokens[1] ?? { surface_form: '' }) === 'する' &&
    tokens.slice(2).every((token) => ['助動詞', '助詞'].includes(token.pos ?? ''));
  return [
    ...new Set([
      term,
      ...(exact ? [canonicalLemma(exact)] : []),
      ...(tokens.length === 1 ? [canonicalLemma(tokens[0])] : []),
      ...(inflection || verbalNoun ? [canonicalLemma(stem)] : []),
    ]),
  ];
}
export function matchLexicalEntries(
  entries: LexiconEntry[],
  lemma: string,
  selected: string,
  preferredReading?: string,
): LexicalMatch[] {
  return entries
    .flatMap((entry) => {
      const orthography = entry.kanji.find((item) => item.text === lemma);
      const readings = entry.kana.filter((item) =>
        orthography
          ? item.appliesToKanji.includes('*') || item.appliesToKanji.includes(lemma)
          : item.text === lemma,
      );
      if (!readings.length) return [];
      const ordered = [...readings].sort(
        (a, b) =>
          Number(b.text === preferredReading) - Number(a.text === preferredReading) ||
          Number(b.common) - Number(a.common),
      );
      return ordered.flatMap((reading) => {
        const senses = entry.sense.filter(
          (sense) =>
            sense.gloss.length &&
            (sense.appliesToKanji.includes('*') ||
              !orthography ||
              sense.appliesToKanji.includes(lemma)) &&
            (sense.appliesToKana.includes('*') || sense.appliesToKana.includes(reading.text)),
        );
        return senses.length
          ? [
              {
                entry,
                lemma,
                reading: hiragana(reading.text),
                senses,
                common: !!orthography?.common || reading.common,
                deinflected: lemma !== selected,
              },
            ]
          : [];
      });
    })
    .sort(
      (a, b) =>
        Number(b.reading === preferredReading) - Number(a.reading === preferredReading) ||
        Number(b.common) - Number(a.common) ||
        a.entry.id.localeCompare(b.entry.id),
    );
}
