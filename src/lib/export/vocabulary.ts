import type { DictionaryEntry } from '../dictionary/types';
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
};
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
];
export function vocabularyRows(entries: DictionaryEntry[]): VocabularyExportRow[] {
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
  }));
}
function cell(value: string | number) {
  let text = String(value);
  // Neutralize spreadsheet formulas even after leading spaces/control characters.
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function vocabularyCsv(rows: VocabularyExportRow[]) {
  return (
    '﻿' +
    [
      columns.map(cell).join(','),
      ...rows.map((r) => columns.map((k) => cell(r[k])).join(',')),
    ].join('\r\n') +
    '\r\n'
  );
}

/** Anki-compatible plain TSV: one record per line, formula protection preserved. */
export function vocabularyTsv(rows: VocabularyExportRow[]) {
  const safe = (value: string | number) => {
    let text = String(value).replaceAll('\t', ' ').replaceAll('\r', ' ').replaceAll('\n', ' ');
    if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text;
    return text;
  };
  return (
    [columns.join('\t'), ...rows.map((r) => columns.map((k) => safe(r[k])).join('\t'))].join('\n') +
    '\n'
  );
}
