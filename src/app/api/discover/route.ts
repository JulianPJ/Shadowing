import { handleFeedRequest } from '@/lib/discover/server';
import { localAuth } from '@/lib/auth/local';
export async function GET(request: Request) {
  return handleFeedRequest(request, (await localAuth())?.database);
}
export const POST = GET;
