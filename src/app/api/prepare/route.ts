import { createPrepareHandler } from '@/lib/prepare';
import { createYoutubeCaptions } from '@/lib/providers/transcription';
import { recordPreparationState } from '@/lib/discover/preparation-state';
import { publicLimit, sharedStorage, workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  const limited = await publicLimit(request, 'prepare');
  if (limited) return limited;
  const db = workerEnv.HIBIKI_DB;
  return createPrepareHandler({
    captions: createYoutubeCaptions(
      workerEnv.YOUTUBE_CAPTION_RELAY_URL,
      workerEnv.YOUTUBE_CAPTION_RELAY_TOKEN,
    ),
    repository: sharedStorage().transcripts,
    onOutcome: db ? (videoId, code) => recordPreparationState(db, videoId, code) : undefined,
  })(request);
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
