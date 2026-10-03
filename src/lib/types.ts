export type Cue = { start: number; end: number; text: string; translation?: string; estimated?: boolean };
export type Segment = { id: string; start: number; end: number; japanese: string; translation?: string; estimated?: boolean };
export type Lesson = {
  id: string; title: string; author: string; source: 'demo' | 'youtube' | 'upload';
  videoId?: string; mediaUrl?: string; mediaName?: string; segments: Segment[];
  transcriptSource: string; notice?: string;
};
export type Mode = 'shadowing' | 'continuous';
export type PlaybackState = 'ready' | 'listening' | 'paused' | 'your-turn' | 'complete';
export interface TranscriptionProvider<Input = string> {
  name: string;
  transcribe(input: Input, signal?: AbortSignal): Promise<{ cues: Cue[]; title?: string; author?: string }>;
}
export interface TranslationProvider {
  name: string;
  translate(japanese: string, signal?: AbortSignal): Promise<string>;
}
// A future provider can return qualitative feedback, without claiming a pronunciation score.
export interface PronunciationAnalysisProvider {
  name: string;
  analyze(recording: Blob, target: Segment): Promise<{ recognizedText?: string; feedback: string[] }>;
}
