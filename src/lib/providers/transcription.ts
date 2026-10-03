import { fetchTranscript } from 'youtube-transcript-plus';
import type { TranscriptionProvider } from '../types';
import { parseSubtitles } from '../subtitles';

export const youtubeCaptions: TranscriptionProvider = {
  name: 'YouTube Japanese captions',
  async transcribe(videoId, signal) {
    const result = await fetchTranscript(videoId, { lang: 'ja', videoDetails: true, signal, retries: 0 });
    return { cues: result.segments.map(cue => ({ start: cue.offset, end: cue.offset + cue.duration, text: cue.text })), title: result.videoDetails.title, author: result.videoDetails.author };
  },
};
export const importedSubtitles: TranscriptionProvider = {
  name: 'Imported subtitles',
  async transcribe(text) { return { cues: parseSubtitles(text) }; },
};
