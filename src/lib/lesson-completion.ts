import type { Lesson, QuizAttempt } from './types';
import type { ShadowingScoreSession } from './shadowing-session';
import { transcriptRevision } from './transcript';
export type RevisitSection = { index: number; reason: string };
/** Explainable existing evidence only; no weakness model or new telemetry. */
export function completionRevisitSections(
  lesson: Lesson,
  scores: ShadowingScoreSession,
  attempt: QuizAttempt | null,
  favorites: string[],
  expectedTranscriptKey: string | null,
): RevisitSection[] {
  const items: RevisitSection[] = [];
  const add = (id: string, reason: string) => {
    const index = lesson.segments.findIndex((s) => s.id === id);
    if (index >= 0 && !items.some((s) => s.index === index) && items.length < 3)
      items.push({ index, reason });
  };
  if (scores.lessonId === lesson.id && scores.transcriptRevision === transcriptRevision(lesson)) {
    const lowest = Object.values(scores.sections)
      .filter((s) => s.score < 100 && lesson.segments.some((segment) => segment.id === s.sectionId))
      .sort((a, b) => a.score - b.score || a.sectionId.localeCompare(b.sectionId))[0];
    if (lowest) add(lowest.sectionId, 'Lowest Shadowing Match attempt');
  }
  if (
    attempt?.completedAt &&
    attempt.lessonId === lesson.id &&
    attempt.transcriptKey === expectedTranscriptKey
  )
    for (const result of attempt.results)
      if (!result.correct)
        for (const id of result.evidence.segmentIds) add(id, 'Missed in comprehension check');
  for (const id of favorites) add(id, 'Bookmarked');
  return items;
}
