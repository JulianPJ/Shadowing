import { BodyLimitError, readBoundedText } from '../http-body';
import type { DictionaryRepository } from './types';
import { DictionaryValidationError, validateDictionarySaveInput } from './validation';
import { readDictionaryQuery, validateDictionaryIds } from './query';

export async function handleDictionaryRequest(
  request: Request,
  userId: string,
  emailVerified: boolean,
  repository: DictionaryRepository,
) {
  const headers = { 'Cache-Control': 'no-store', Vary: 'Cookie' };
  const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const query = readDictionaryQuery(params);
      if (params.has('ids')) {
        if ([...params.keys()].some((k) => k !== 'ids'))
          throw new DictionaryValidationError('Invalid dictionary query');
        const ids = validateDictionaryIds(params.get('ids')!.split(','));
        const entries = await repository.byIds(userId, ids);
        // Missing or foreign IDs return no material, without disclosing their owner/existence.
        if (entries.length !== ids.length)
          return respond({ error: 'Selected vocabulary is unavailable. Refresh review.' }, 404);
        return respond({ entries });
      }
      return respond(await repository.page(userId, query));
    }
    if (request.method !== 'POST') return respond({ error: 'Method not supported' }, 405);
    if (!emailVerified)
      return respond({ error: 'Verify your email before saving vocabulary.' }, 403);
    const body = JSON.parse(await readBoundedText(request, 32_000)) as Record<string, unknown>;
    if (body.action === 'delete') {
      if (typeof body.id !== 'string' || !/^[\w-]{1,100}$/.test(body.id))
        throw new DictionaryValidationError('Invalid dictionary entry');
      await repository.remove(userId, body.id);
      return respond({ ok: true });
    }
    if (body.action !== 'save') throw new DictionaryValidationError('Invalid dictionary action');
    const input = validateDictionarySaveInput(body.entry);
    return respond({ entry: await repository.save(userId, input) });
  } catch (error) {
    if (error instanceof BodyLimitError)
      return respond({ error: 'Dictionary record is too large' }, 413);
    if (error instanceof SyntaxError || error instanceof DictionaryValidationError)
      return respond({ error: 'Invalid dictionary record' }, 400);
    return respond({ error: 'Your dictionary is temporarily unavailable' }, 503);
  }
}
