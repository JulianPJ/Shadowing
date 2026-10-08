import { readStorage, writeStorage } from '../storage/browser';
import type { ReviewGrade, ReviewOperation, ReviewSnapshot } from './types';
export type ReviewEvent = {
  operationId: string;
  entryId: string;
  grade: ReviewGrade;
  reviewedAt: string;
  status?: 'new' | 'learning' | 'review';
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
    .slice(-10000);
}
export function rememberReview(event: ReviewEvent) {
  const history = reviewHistory();
  if (!history.some((old) => old.operationId === event.operationId))
    writeStorage('review:history', [...history, event].slice(-10000));
}
export function forgetReview(operationId: string) {
  writeStorage(
    'review:history',
    reviewHistory().filter((event) => event.operationId !== operationId),
  );
}
/** A server window is authoritative; pending local ratings remain visible until accepted or rejected. */
export function reconcileReviewHistory(snapshot: ReviewSnapshot, pending: ReviewOperation[]) {
  if (!Array.isArray(snapshot.history) || !Number.isFinite(Date.parse(snapshot.historySince ?? '')))
    return;
  const local = reviewHistory();
  const since = Date.parse(snapshot.historySince!);
  const windowStart = Date.parse(snapshot.historyWindowStart ?? snapshot.historySince!);
  const authoritative = new Set(readStorage<string[]>('review:authoritative-history-ids', []));
  const pendingGrades = pending.flatMap((operation) => {
    if (operation.action !== 'grade') return [];
    const existing = local.find((event) => event.operationId === operation.operationId);
    return [
      existing ?? {
        operationId: operation.operationId,
        entryId: operation.entryId,
        grade: operation.grade,
        reviewedAt: operation.reviewedAt,
        status: operation.revision === 0 ? ('new' as const) : ('review' as const),
      },
    ];
  });
  const undone = new Set(
    pending.flatMap((operation) =>
      operation.action === 'undo' ? [operation.targetOperationId] : [],
    ),
  );
  const merged = [
    ...new Map(
      [
        ...local.filter(
          (event) =>
            Date.parse(event.reviewedAt) < windowStart ||
            (Date.parse(event.reviewedAt) < since && !authoritative.has(event.operationId)),
        ),
        ...snapshot.history,
        ...pendingGrades,
      ].map((event) => [event.operationId, event]),
    ).values(),
  ]
    .filter((event) => !undone.has(event.operationId))
    .sort(
      (a, b) =>
        a.reviewedAt.localeCompare(b.reviewedAt) || a.operationId.localeCompare(b.operationId),
    )
    .slice(-10000);
  writeStorage('review:history', merged);
  writeStorage(
    'review:authoritative-history-ids',
    snapshot.history.map((event) => event.operationId).slice(-10000),
  );
}
