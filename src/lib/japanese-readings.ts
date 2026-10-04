// Derived display data only. Never attach readings to a Lesson or Segment.
export type JapaneseReadingToken = Readonly<{ text: string; reading?: string }>;
export type MorphologicalToken = { surface_form: string; reading?: string; word_type?: string };
export const FURIGANA_GENERATOR_VERSION = 'kuromoji-0.1.2-ipadic-v1';
export const hasKanji = (text: string) => /[\p{Script=Han}々〆]/u.test(text);
export function hiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
}

// Align kana within dictionary tokens so okurigana keeps its original typography.
// If alignment is ambiguous, annotate the complete word rather than inventing a split.
export function alignReading(text: string, reading: string): JapaneseReadingToken[] {
  const parts = text.match(/[\p{Script=Han}々〆]+|[^\p{Script=Han}々〆]+/gu) || [];
  const solutions: JapaneseReadingToken[][] = [];
  let visits = 0;
  function align(index: number, offset: number, tokens: JapaneseReadingToken[]) {
    if (solutions.length > 1 || ++visits > 1000) return;
    if (index === parts.length) { if (offset === reading.length) solutions.push(tokens); return; }
    const part = parts[index];
    if (!hasKanji(part)) {
      const kana = hiragana(part);
      if (reading.startsWith(kana, offset)) align(index + 1, offset + kana.length, [...tokens, { text: part }]);
      return;
    }
    for (let end = offset + 1; end <= reading.length; end++) {
      align(index + 1, end, [...tokens, { text: part, reading: reading.slice(offset, end) }]);
    }
  }
  // Dictionary words are short; bound recursion even for malformed input.
  if (parts.length <= 12 && reading.length <= 80) align(0, 0, []);
  return solutions.length === 1 && visits <= 1000 ? solutions[0] : [{ text, reading }];
}

export function annotateJapanese(text: string, analyzed: readonly MorphologicalToken[]): readonly JapaneseReadingToken[] {
  // Reject normalization or token loss: the visible bases must reconstruct the exact source.
  if (analyzed.map(token => token.surface_form).join('') !== text) return [{ text }];
  return analyzed.flatMap(token => {
    const reading = token.reading ? hiragana(token.reading) : '';
    if (token.word_type !== 'KNOWN' || !hasKanji(token.surface_form) || !/^[ぁ-ゖー]+$/.test(reading)) return [{ text: token.surface_form }];
    return alignReading(token.surface_form, reading);
  });
}
