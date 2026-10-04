import { readBoundedText, BodyLimitError } from './http-body';
import { QuizValidationError } from './transcript-validation';
export async function readBoundedJson(
  source: Request | Response,
  maxBytes: number,
): Promise<unknown> {
  if (!source.body) throw new QuizValidationError('Missing body.');
  try {
    return JSON.parse(await readBoundedText(source, maxBytes));
  } catch (error) {
    if (error instanceof BodyLimitError) throw new QuizValidationError('Body too large.');
    throw error;
  }
}
