import { BodyLimitError, readBoundedText } from '../http-body';
import { ReviewConflict } from './repository';
import type { ReviewRepository } from './types';
import { validateReviewOperation } from './validation';
export async function handleReviewRequest(
  request: Request,
  userId: string,
  verified: boolean,
  repository: ReviewRepository,
) {
  const respond = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  try {
    if (request.method === 'GET') return respond(await repository.snapshot(userId));
    if (request.method !== 'POST') return respond({ error: 'Method not supported' }, 405);
    if (!verified) return respond({ error: 'Verify your email before reviewing.' }, 403);
    const op = validateReviewOperation(JSON.parse(await readBoundedText(request, 16000)));
    await repository.apply(userId, op);
    return respond({ ok: true });
  } catch (error) {
    if (error instanceof ReviewConflict)
      return respond({ code: 'review-conflict', error: error.message }, 409);
    if (error instanceof BodyLimitError) return respond({ error: 'Review batch too large' }, 413);
    if (error instanceof SyntaxError || (error instanceof Error && /Invalid/.test(error.message)))
      return respond({ error: 'Invalid review operation' }, 400);
    return respond({ error: 'Review storage unavailable. Your local changes can retry.' }, 503);
  }
}
