export async function POST() {
  return Response.json(
    {
      error:
        'Shadowing summary is available in the deployed Hibiki Worker. Use the production Worker runtime for Workers AI analysis.',
    },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  );
}
