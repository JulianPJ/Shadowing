export async function POST() {
  return Response.json(
    {
      error:
        'Shadowing AI analysis is available in the deployed Hibiki app with its Cloudflare Workers AI binding.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
