import { sha256 } from './media';
import { validateCues } from './segmentation';
import type { Cue, LinkedMediaSource, TranscriptSource } from './types';

export type StoredTranscript = {
  schemaVersion: 1; contentKey: string; media: LinkedMediaSource; language: 'ja';
  source: TranscriptSource; cues: Cue[]; transcriptHash: string; createdAt: string;
  visibility: 'private' | 'shared' | 'system'; generatorVersion?: string; model?: string; ownerId?: string;
};
export interface LinkedTranscriptRepository {
  lookup(input: { contentKey: string; language: 'ja' }): Promise<StoredTranscript | null>;
  save(input: StoredTranscript): Promise<void>;
}
export const linkedTranscripts: LinkedTranscriptRepository = {
  async lookup() { return null; }, async save() { /* No hosted storage; user imports stay private. */ },
};
// Contract only. A future implementation needs an approved audio-access path first.
export interface GeneratedTranscriptProvider {
  transcribe(input: LinkedMediaSource, signal: AbortSignal): Promise<{ cues: Cue[]; source: TranscriptSource; generatorVersion: string; model?: string }>;
}
export async function transcriptHash(cues: Cue[]) {
  return sha256(JSON.stringify(validateCues(cues).map(({ start, end, text, translation, estimated }) => ({ start, end, text, translation, estimated }))));
}
export function needsUserTranscript(code: unknown) { return code === 'no-japanese-captions' || code === 'no-caption-provider'; }
