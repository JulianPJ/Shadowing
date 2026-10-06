import { readStorage, writeStorage } from '../storage/browser';
import type { ReviewGrade } from './types';
export type ReviewEvent = {
  operationId: string;
  entryId: string;
  grade: ReviewGrade;
  reviewedAt: string;
};
export function reviewHistory(): ReviewEvent[] {
  const raw = readStorage<unknown>('review:history', []);
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  return raw
    .filter((item): item is ReviewEvent => {
      if (
        !item ||
        typeof item.operationId !== 'string' ||
        typeof item.entryId !== 'string' ||
        !['again', 'hard', 'good', 'easy'].includes(item.grade) ||
        !Number.isFinite(Date.parse(item.reviewedAt)) ||
        seen.has(item.operationId)
      )
        return false;
      seen.add(item.operationId);
      return true;
    })
    .slice(-2000);
}
export function rememberReview(event: ReviewEvent) {
  const history = reviewHistory();
  if (!history.some((old) => old.operationId === event.operationId))
    writeStorage('review:history', [...history, event].slice(-2000));
}
