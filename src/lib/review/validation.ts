import type { ReviewOperation } from './types';
export function validateReviewOperation(value: unknown): ReviewOperation {
  if (!value || typeof value !== 'object') throw new Error('Invalid review operation');
  const v = value as Record<string, unknown>;
  const id = (x: unknown) => typeof x === 'string' && /^[\w-]{1,100}$/.test(x);
  const ids = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 100 && x.every(id);
  const revision = Number.isSafeInteger(v.revision) && (v.revision as number) >= 0;
  const date = (x: unknown) =>
    typeof x === 'string' &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) &&
    Number.isFinite(Date.parse(x));
  let valid = false;
  switch (v.action) {
    case 'deck':
      valid =
        id(v.id) &&
        v.id !== 'inbox' &&
        typeof v.name === 'string' &&
        v.name.trim().length > 0 &&
        v.name.length <= 80;
      break;
    case 'delete-deck':
      valid = id(v.deckId) && v.deckId !== 'inbox';
      break;
    case 'membership':
      valid = id(v.deckId) && ids(v.entryIds) && typeof v.remove === 'boolean';
      break;
    case 'enroll':
      valid =
        id(v.deckId) &&
        ids(v.entryIds) &&
        typeof v.enrolledAt === 'string' &&
        Number.isFinite(Date.parse(v.enrolledAt)) &&
        Date.parse(v.enrolledAt) <= Date.now() + 300000;
      break;
    case 'suspend':
      valid = id(v.operationId) && id(v.entryId) && revision;
      break;
    case 'grade':
      valid =
        id(v.operationId) &&
        id(v.entryId) &&
        revision &&
        ['again', 'hard', 'good', 'easy'].includes(String(v.grade)) &&
        typeof v.reviewedAt === 'string' &&
        /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.reviewedAt) &&
        Number.isFinite(Date.parse(v.reviewedAt)) &&
        Date.parse(v.reviewedAt) <= Date.now() + 300000;
      break;
    case 'undo': {
      const previous = v.previous as Record<string, unknown> | null;
      const count = (x: unknown) => Number.isSafeInteger(x) && (x as number) >= 0;
      valid =
        id(v.operationId) &&
        id(v.targetOperationId) &&
        v.operationId !== v.targetOperationId &&
        id(v.entryId) &&
        revision &&
        date(v.undoneAt) &&
        Date.parse(v.undoneAt as string) <= Date.now() + 300000 &&
        !!previous &&
        previous.entryId === v.entryId &&
        previous.schemaVersion === 1 &&
        previous.algorithm === 'sm2-v1' &&
        ['new', 'learning', 'review'].includes(String(previous.status)) &&
        previous.revision === (v.revision as number) - 1 &&
        count(previous.repetitions) &&
        count(previous.lapses) &&
        count(previous.intervalDays) &&
        (previous.intervalDays as number) <= 36500 &&
        typeof previous.ease === 'number' &&
        Number.isFinite(previous.ease) &&
        previous.ease >= 1.3 &&
        date(previous.dueAt) &&
        date(previous.createdAt) &&
        date(previous.updatedAt) &&
        (previous.lastReviewedAt === null || date(previous.lastReviewedAt)) &&
        Date.parse(previous.updatedAt as string) <= Date.parse(v.undoneAt as string);
      break;
    }
  }
  if (!valid) throw new Error('Invalid review operation');
  return v as ReviewOperation;
}
