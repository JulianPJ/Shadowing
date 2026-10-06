import type { ReviewOperation } from './types';
export function validateReviewOperation(value: unknown): ReviewOperation {
  if (!value || typeof value !== 'object') throw new Error('Invalid review operation');
  const v = value as Record<string, unknown>;
  const id = (x: unknown) => typeof x === 'string' && /^[\w-]{1,100}$/.test(x);
  const ids = (x: unknown) => Array.isArray(x) && x.length > 0 && x.length <= 100 && x.every(id);
  const revision = Number.isSafeInteger(v.revision) && (v.revision as number) >= 0;
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
  }
  if (!valid) throw new Error('Invalid review operation');
  return v as ReviewOperation;
}
