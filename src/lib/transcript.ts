import { sha256 } from './hash';
import type { QuizLesson, Segment } from './types';
import { QuizValidationError, object, text } from './transcript-validation';
export function validateQuizLesson(
  value: unknown,
  limits = { maxSegments: 2000, maxCharacters: 60000 },
): QuizLesson {
  const raw = object(value);
  const id = text(raw.id, 200);
  const videoId = raw.videoId === undefined ? undefined : text(raw.videoId, 100);
  if (
    !Array.isArray(raw.segments) ||
    !raw.segments.length ||
    raw.segments.length > limits.maxSegments
  )
    throw new QuizValidationError('A supported transcript is required.');
  const ids = new Set<string>();
  let previousEnd = 0;
  const segments: Segment[] = raw.segments.map((value) => {
    const s = object(value);
    const id = text(s.id, 200);
    if (
      ids.has(id) ||
      typeof s.start !== 'number' ||
      typeof s.end !== 'number' ||
      !Number.isFinite(s.start) ||
      !Number.isFinite(s.end) ||
      s.start < previousEnd ||
      s.end <= s.start ||
      s.end > 86400
    )
      throw new QuizValidationError('Invalid normalized segments.');
    ids.add(id);
    previousEnd = s.end;
    return { id, start: s.start, end: s.end, japanese: text(s.japanese, 5000) };
  });
  if (segments.reduce((n, s) => n + s.japanese.length, 0) > limits.maxCharacters)
    throw new QuizValidationError(
      limits.maxCharacters === 60000
        ? 'This transcript is too long for a short comprehension check.'
        : 'This transcript is too long for analysis.',
    );
  return { id, ...(videoId ? { videoId } : {}), segments };
}

export function transcriptRevision(lesson: QuizLesson): string {
  return JSON.stringify(lesson.segments.map((s) => [s.id, s.start, s.end, s.japanese.trim()]));
}

export async function transcriptKey(lesson: QuizLesson): Promise<string> {
  return sha256(transcriptRevision(lesson));
}
