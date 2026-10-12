import { sha256 } from '../hash';
import { readBoundedJson } from '../http-json';

/**
 * Videos per manual request. Each costs a caption fetch and one or more Clef calls inside one
 * request's CPU and subrequest limits, so larger batches are a loop of requests
 * (`npm run discover:analyse`).
 */
export const MANUAL_ANALYSIS_MAX = 3;
// Long enough that a guessable value is never accepted.
const MIN_TOKEN_LENGTH = 32;
const noStore = { 'Cache-Control': 'no-store' };

/**
 * Operator-only trigger for the Discover difficulty analysis, outside the nightly schedule and
 * cap. Without a configured token, or with the wrong one, the route does not exist.
 */
export async function handleManualAnalysis(
  request: Request,
  token: string | undefined,
  run: (limit: number) => Promise<unknown>,
) {
  const supplied = request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
  // Comparing digests keeps the comparison independent of where the strings first differ.
  if (
    !token ||
    token.length < MIN_TOKEN_LENGTH ||
    !supplied ||
    (await sha256(supplied)) !== (await sha256(token))
  )
    return Response.json({ error: 'Not found' }, { status: 404, headers: noStore });
  let count: unknown;
  try {
    count = ((await readBoundedJson(request, 1024)) as { count?: unknown }).count;
  } catch {
    count = undefined;
  }
  if (!Number.isInteger(count) || (count as number) < 1 || (count as number) > MANUAL_ANALYSIS_MAX)
    return Response.json(
      { error: `count must be an integer from 1 to ${MANUAL_ANALYSIS_MAX}` },
      { status: 400, headers: noStore },
    );
  try {
    return Response.json(await run(count as number), { headers: noStore });
  } catch {
    return Response.json({ error: 'Analysis unavailable' }, { status: 503, headers: noStore });
  }
}
