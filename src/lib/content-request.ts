import type { Lesson, QuizLesson } from './types';

// Browser candidate identity only; the server verifies it against hosted cues.
export function contentRequest(lesson: Lesson, input: QuizLesson) {
  const media = lesson.mediaSource;
  const eligible = media && 'contentKey' in media && ['provider-captions', 'generated'].includes(lesson.transcript?.type ?? '');
  return { lesson: input, ...(eligible ? { content: { contentKey: media.contentKey } } : {}) };
}
export function requestEnvelope(value: unknown): { lesson: unknown; contentKey?: unknown } {
  if (!value || typeof value !== 'object') return { lesson: value };
  const raw = value as Record<string, unknown>;
  const content = raw.content && typeof raw.content === 'object' ? raw.content as Record<string, unknown> : undefined;
  return { lesson: raw.lesson ?? value, contentKey: content?.contentKey };
}
