import { BodyLimitError, readBoundedText } from '../http-body';
import { DictionaryValidationError } from '../dictionary/validation';
import { TagConflict } from './repository';
import { validateTagOperation } from './validation';
import type { TagRepository } from './types';
export async function handleTagRequest(
  request: Request,
  userId: string,
  verified: boolean,
  repository: TagRepository,
) {
  const respond = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  try {
    if (request.method === 'GET') return respond({ tags: await repository.list(userId) });
    if (request.method !== 'POST') return respond({ error: 'Method not supported' }, 405);
    if (!verified) return respond({ error: 'Verify your email before editing tags.' }, 403);
    await repository.apply(
      userId,
      validateTagOperation(JSON.parse(await readBoundedText(request, 12000))),
    );
    return respond({ tags: await repository.list(userId) });
  } catch (error) {
    if (error instanceof TagConflict) return respond({ error: error.message }, 409);
    if (error instanceof BodyLimitError) return respond({ error: 'Tag batch too large' }, 413);
    if (error instanceof SyntaxError || error instanceof DictionaryValidationError)
      return respond({ error: 'Invalid tag operation' }, 400);
    return respond({ error: 'Tags are temporarily unavailable' }, 503);
  }
}
