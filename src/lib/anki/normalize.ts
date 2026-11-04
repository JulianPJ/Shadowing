import type { AnkiModel, AnkiPackage, ImportRecord, Mapping } from './types';
import { roles } from './types';

/** Text only. Never attach package markup to the document or execute templates. */
export function fieldText(value: string) {
  return value
    .replace(/<(script|style|iframe|object|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/\[sound:[^\]]*\]/gi, '')
    .replace(/<br\s*\/?\s*>|<\/div>|<\/p>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity: string) => {
      const named: Record<string, string> = {
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        apos: "'",
        nbsp: ' ',
      };
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? '';
      const n =
        entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    })
    .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, '$1')
    .replace(/[\u0000-\u0008\u000b-\u001f]/g, '')
    .normalize('NFC')
    .trim();
}
export function suggestMapping(model: AnkiModel): Mapping {
  const patterns = [
    /^(word|expression|vocabkanji|vocabulary|term|japanese|front)$/i,
    /^(reading|kana|expressionreading|word with reading|vocabfurigana|wordreading)$/i,
    /^(meaning|definition|maindefinition|vocabdef|english|back)$/i,
    /^(sentence|example sentence|sentkanji|context)$/i,
    /^(sentence translation|sentencetranslation|senteng|translation)$/i,
  ];
  return Object.fromEntries(
    roles.map((r, i) => [r, model.fields.findIndex((f) => patterns[i].test(f.trim()))]),
  ) as Mapping;
}
export function mappedRecords(
  pkg: AnkiPackage,
  decks: string[],
  maps: Record<string, Mapping>,
  mode: 'known' | 'learning' | 'interval',
  cutoff: number,
) {
  if (mode === 'interval' && (!Number.isFinite(cutoff) || cutoff <= 0))
    throw new Error('Enter a positive interval cutoff.');
  let skipped = 0,
    missingIntervals = 0;
  const records: ImportRecord[] = [];
  for (const note of pkg.notes) {
    const cards = note.cards.filter((c) => decks.includes(c.deck));
    if (!cards.length) continue;
    const mapping = maps[note.model];
    const values = Object.fromEntries(
      roles.map((r) => [r, fieldText(note.fields[mapping?.[r]] ?? '')]),
    );
    // Bracket furigana is a mapping suggestion; preserve whole-word readings, never guess a kanji split.
    values.term = values.term
      .replace(/\[[^\]]*\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    values.reading = values.reading.replace(/([^\s\[\]]+)\[([^\]]+)\]/g, '$2').replace(/\s+/g, '');
    if (
      !values.term ||
      values.term.length > 120 ||
      values.reading.length > 120 ||
      values.translation.length > 2000 ||
      values.sourceSentence.length > 5000 ||
      values.sourceSentenceTranslation.length > 10000 ||
      !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(values.term)
    ) {
      skipped++;
      continue;
    }
    if (cards.some((c) => c.interval === null)) missingIntervals++;
    records.push({
      ...values,
      decks: [...new Set(cards.map((c) => c.deck))],
      state:
        mode === 'interval'
          ? cards.every((c) => c.interval !== null && c.interval >= cutoff)
            ? 'known'
            : 'learning'
          : mode,
    } as ImportRecord);
  }
  // Merge identical mapped contexts across notes. Every contributing selected card must qualify.
  const merged = new Map<string, ImportRecord>();
  for (const record of records) {
    const key = JSON.stringify(roles.map((r) => record[r]));
    const old = merged.get(key);
    if (old) {
      old.decks = [...new Set([...old.decks, ...record.decks])];
      if (record.state === 'learning') old.state = 'learning';
    } else merged.set(key, record);
  }
  if (mode === 'interval') {
    const learning = new Set(
      [...merged.values()]
        .filter((r) => r.state === 'learning')
        .map((r) => r.term.normalize('NFKC')),
    );
    for (const r of merged.values())
      if (learning.has(r.term.normalize('NFKC'))) r.state = 'learning';
  }
  return {
    records: [...merged.values()],
    skipped,
    missingIntervals,
    merged: records.length - merged.size,
  };
}
