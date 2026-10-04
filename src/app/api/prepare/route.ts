import { createPrepareHandler } from '@/lib/prepare';
import { youtubeCaptions } from '@/lib/providers/transcription';

export const maxDuration = 30;
export const POST = createPrepareHandler({ captions: youtubeCaptions });
