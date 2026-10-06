export type LexiconOrthography = { text: string; common: boolean; tags: string[] };
export type LexiconReading = LexiconOrthography & { appliesToKanji: string[] };
export type LexiconSense = {
  partOfSpeech: string[];
  appliesToKanji: string[];
  appliesToKana: string[];
  field: string[];
  dialect: string[];
  misc: string[];
  info: string[];
  gloss: string[];
};
export type LexiconEntry = {
  id: string;
  kanji: LexiconOrthography[];
  kana: LexiconReading[];
  sense: LexiconSense[];
};
export type LexicalMatch = {
  entry: LexiconEntry;
  lemma: string;
  reading: string;
  senses: LexiconSense[];
  common: boolean;
  deinflected: boolean;
};
export type LexiconResult = {
  selected: string;
  lemma: string;
  matches: LexicalMatch[];
  tags: Record<string, string>;
  dictionaryDate: string;
};
