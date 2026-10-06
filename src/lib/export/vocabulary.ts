import type { DictionaryEntry } from '../dictionary/types';
import type { ReviewSnapshot } from '../review/types';
import { externalReplay } from '../dictionary/replay';
export type VocabularyExportRow = {
  term: string;
  reading: string;
  translation: string;
  sourceSentence: string;
  sourceTranslation: string;
  lessonTitle: string;
  sourceUrl: string;
  start: number;
  end: number;
  decks: string;
};
export function vocabularyRows(
  entries: DictionaryEntry[],
  review: ReviewSnapshot,
): VocabularyExportRow[] {
  return entries.map((e) => ({
    term: e.term,
    reading: e.reading ?? '',
    translation: e.translation,
    sourceSentence: e.sourceSentence,
    sourceTranslation: e.sourceSentenceTranslation,
    lessonTitle: e.source.lessonTitle,
    sourceUrl: externalReplay(e) ?? '',
    start: e.source.start,
    end: e.source.end,
    decks: review.memberships
      .filter((m) => m.entryId === e.id)
      .map((m) => review.decks.find((d) => d.id === m.deckId)?.name ?? '')
      .filter(Boolean)
      .join('; '),
  }));
}
function cell(value: string | number) {
  let text = String(value);
  // Neutralize spreadsheet formulas even after leading spaces/control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function vocabularyCsv(rows: VocabularyExportRow[]) {
  const columns: (keyof VocabularyExportRow)[] = [
    'term',
    'reading',
    'translation',
    'sourceSentence',
    'sourceTranslation',
    'lessonTitle',
    'sourceUrl',
    'start',
    'end',
    'decks',
  ];
  return (
    '\uFEFF' +
    [
      columns.map(cell).join(','),
      ...rows.map((r) => columns.map((k) => cell(r[k])).join(',')),
    ].join('\r\n') +
    '\r\n'
  );
}
