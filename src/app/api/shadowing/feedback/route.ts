import { localRequirePro } from '@/lib/auth/local-handler';

export async function POST(request: Request) {
  const denied = await localRequirePro(request);
  if (denied) return denied;
  return Response.json(
    {
      error:
        'Shadowing AI analysis is available in the deployed Hibiki app with its Cloudflare Workers AI binding.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
