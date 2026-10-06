import { wordStates, type WordKnowledgeRecord } from './types';
export function normalizeLemma(lemma: string) {
  return lemma.normalize('NFC').trim();
}
export function validateKnowledgeRecord(value: unknown): WordKnowledgeRecord {
  if (!value || typeof value !== 'object') throw new Error('Invalid word state');
  const record = value as WordKnowledgeRecord;
  if (
    typeof record.lemma !== 'string' ||
    normalizeLemma(record.lemma) !== record.lemma ||
    !record.lemma ||
    record.lemma.length > 120 ||
    !/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(record.lemma) ||
    /[\u0000-\u001f]/.test(record.lemma) ||
    !wordStates.includes(record.state) ||
    (record.reading !== null &&
      (typeof record.reading !== 'string' || record.reading.length > 120)) ||
    typeof record.updatedAt !== 'string' ||
    !Number.isFinite(Date.parse(record.updatedAt)) ||
    new Date(record.updatedAt).toISOString() !== record.updatedAt
  )
    throw new Error('Invalid word state');
  return {
    lemma: record.lemma,
    reading: record.reading,
    state: record.state,
    updatedAt: record.updatedAt,
  };
}
export function mergeKnowledge(...collections: WordKnowledgeRecord[][]) {
  const records = new Map<string, WordKnowledgeRecord>();
  for (const collection of collections) {
    for (const candidate of collection) {
      let record;
      try {
        record = validateKnowledgeRecord(candidate);
      } catch {
        continue;
      }
      const old = records.get(record.lemma);
      // Deterministic equal-date ordering converges in either device merge order.
      if (
        !old ||
        record.updatedAt > old.updatedAt ||
        (record.updatedAt === old.updatedAt &&
          (record.state > old.state ||
            (record.state === old.state && (record.reading ?? '') > (old.reading ?? ''))))
      )
        records.set(record.lemma, record);
    }
  }
  return Object.fromEntries(records);
}
