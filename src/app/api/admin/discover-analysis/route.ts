import { analyseUnplacedVideos } from '@/lib/discover/analysis';
import { handleManualAnalysis } from '@/lib/discover/analysis-admin';
import { createYoutubeCaptions } from '@/lib/providers/transcription';
import { workerEnv } from '@/lib/server/runtime';

export async function POST(request: Request) {
  return handleManualAnalysis(request, workerEnv.DISCOVER_ADMIN_TOKEN, async (limit) => {
    if (!workerEnv.HIBIKI_DB) throw new Error('Catalogue unavailable');
    return analyseUnplacedVideos({
      db: workerEnv.HIBIKI_DB,
      ai: workerEnv.AI,
      captions: createYoutubeCaptions(
        workerEnv.YOUTUBE_CAPTION_RELAY_URL,
        workerEnv.YOUTUBE_CAPTION_RELAY_TOKEN,
      ),
      limit,
      nightlyCap: null,
    });
  });
}

// API responses are per-request and never enter the framework response cache.
export const dynamic = 'force-dynamic';
