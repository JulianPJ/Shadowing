import { localRequirePro } from '@/lib/auth/local-handler';

export async function POST(request: Request) {
  const denied = await localRequirePro(request);
  if (denied) return denied;
  return Response.json(
    {
      error:
        'Cloudflare Workers AI transcription is available in the deployed Hibiki app. Configure NEXT_PUBLIC_WHISPER_URL to use the optional local Whisper fallback during local development.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
