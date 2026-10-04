export class QuizValidationError extends Error {}

export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new QuizValidationError('Expected an object.');
  return value as Record<string, unknown>;
}

export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new QuizValidationError('Unexpected fields.');
}

export function text(value: unknown, max = 600): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    throw new QuizValidationError('Invalid text.');
  return value.trim();
}
