import type { TranscriptionProvider } from '../types';
import { parseSubtitles } from '../subtitles';
import { createCaptionRelay, createDirectYoutubeCaptions, withTranscriptionFallback } from './youtube-captions';
import { env } from 'node:process';

export const youtubeCaptions: TranscriptionProvider = {
  name: 'YouTube Japanese captions',
  async transcribe(videoId, signal) {
    const direct = createDirectYoutubeCaptions();
    const url = env.YOUTUBE_CAPTION_RELAY_URL;
    const token = env.YOUTUBE_CAPTION_RELAY_TOKEN;
    // Prefer the configured egress relay in production; a content error is terminal.
    const providers = url && token ? [createCaptionRelay(url, token), direct] : [direct];
    console.info(JSON.stringify({ event: 'captions.providers', videoId, providers: providers.map(provider => provider.name) }));
    return withTranscriptionFallback(providers).transcribe(videoId, signal);
  },
};
export const importedSubtitles: TranscriptionProvider = {
  name: 'Imported subtitles',
  async transcribe(text) { return { cues: parseSubtitles(text) }; },
};
