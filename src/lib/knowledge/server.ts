import { BodyLimitError, readBoundedText } from '../http-body';
import type { KnowledgeRepository } from './types';
import { validateKnowledgeRecord } from './validation';
export async function handleKnowledgeRequest(
  request: Request,
  userId: string,
  verified: boolean,
  repository: KnowledgeRepository,
) {
  const respond = (body: unknown, status = 200) =>
    Response.json(body, { status, headers: { 'Cache-Control': 'no-store', Vary: 'Cookie' } });
  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key) => key !== 'cursor' && key !== 'since'))
        throw new Error('Invalid query');
      return respond(await repository.page(userId, params.get('cursor'), params.get('since')));
    }
    if (request.method !== 'POST') return respond({ error: 'Method not supported' }, 405);
    if (!verified) return respond({ error: 'Verify your email before syncing word states.' }, 403);
    const body = JSON.parse(await readBoundedText(request, 64000));
    if (!Array.isArray(body.records) || !body.records.length || body.records.length > 100)
      throw new Error('Invalid batch');
    const records = body.records.map(validateKnowledgeRecord);
    if (
      records.some(
        (record: { updatedAt: string }) => Date.parse(record.updatedAt) > Date.now() + 300000,
      )
    )
      throw new Error('Invalid update time');
    return respond({ ok: true, records: await repository.apply(userId, records) });
  } catch (error) {
    if (error instanceof BodyLimitError)
      return respond({ error: 'Word state batch too large' }, 413);
    if (
      error instanceof SyntaxError ||
      (error instanceof Error && error.message.startsWith('Invalid'))
    )
      return respond({ error: 'Invalid word state request' }, 400);
    return respond({ error: 'Word states are saved on this device and will retry syncing.' }, 503);
  }
}
