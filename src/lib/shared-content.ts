import { storageFallback, storageEvent } from './d1';
import { linkedTranscripts, validContentKey, validateStoredTranscript, type LinkedTranscriptRepository } from './linked-transcripts';
import { segmentTranscript } from './segmentation';
import { transcriptKey, validateQuizLesson } from './quiz';
import { generatedArtifacts, validateArtifactPayload, type ArtifactLookup, type GeneratedArtifactRepository, type ArtifactType } from './generated-artifacts';
import type { ContentDifficultyAnalysis, LessonQuiz, QuizLesson } from './types';

export type SharedContentDependencies = { transcripts: LinkedTranscriptRepository; artifacts: GeneratedArtifactRepository };
export const noSharedContent: SharedContentDependencies = { transcripts: linkedTranscripts, artifacts: generatedArtifacts };
export type TrustedContent = { identity: ArtifactLookup; sourceTranscriptHash: string; lesson: QuizLesson };
export async function trustedContent(contentKey: unknown, lesson: QuizLesson, artifactType: ArtifactType, generatorVersion: string, deps: SharedContentDependencies): Promise<TrustedContent | null> {
  if (!validContentKey(contentKey)) return null;
  return storageFallback('d1.transcript.lookup_failed', null, async () => {
    const raw = await deps.transcripts.lookup({ contentKey, language: 'ja' });
    if (!raw) return null;
    const stored = await validateStoredTranscript(raw);
    if (stored.contentKey !== contentKey) return null;
    const canonical = validateQuizLesson({ id: contentKey.replace(':', '-'), segments: segmentTranscript(stored.cues) }, { maxSegments: 10000, maxCharacters: 300000 });
    const key = await transcriptKey(canonical);
    if (key !== await transcriptKey(lesson)) return null;
    return { identity: { contentKey, transcriptKey: key, artifactType, schemaVersion: 1, generatorVersion }, sourceTranscriptHash: stored.transcriptHash, lesson: canonical };
  });
}
function rebind(payload: LessonQuiz | ContentDifficultyAnalysis, lesson: QuizLesson, type: ArtifactType) {
  return { ...payload, lessonId: lesson.id, ...(type === 'difficulty' ? { id: `difficulty:v1:${lesson.id}:${payload.transcriptKey}` } : {}) };
}
export async function loadSharedArtifact(trusted: TrustedContent | null, lesson: QuizLesson, deps: SharedContentDependencies) {
  if (!trusted) return null;
  const type = trusted.identity.artifactType;
  return storageFallback('d1.artifact.lookup_failed', null, async () => {
    const stored = await deps.artifacts.lookup(trusted.identity);
    if (!stored || stored.sourceTranscriptHash !== trusted.sourceTranscriptHash || Object.entries(trusted.identity).some(([k, v]) => stored[k as keyof ArtifactLookup] !== v)) { storageEvent('d1.artifact.miss', type); return null; }
    const canonical = await validateArtifactPayload(type, stored.payload, trusted.lesson);
    const payload = await validateArtifactPayload(type, rebind(canonical, lesson, type), lesson);
    storageEvent('d1.artifact.hit', type);
    return payload;
  }, type);
}
export async function saveSharedArtifact(trusted: TrustedContent | null, payload: LessonQuiz | ContentDifficultyAnalysis, deps: SharedContentDependencies) {
  if (!trusted) return;
  const type = trusted.identity.artifactType;
  await storageFallback('d1.artifact.save_failed', undefined, async () => {
    const canonical = await validateArtifactPayload(type, rebind(payload, trusted.lesson, type), trusted.lesson);
    await deps.artifacts.save({ ...trusted.identity, sourceTranscriptHash: trusted.sourceTranscriptHash, payload: canonical, payloadId: canonical.id, createdAt: canonical.generatedAt }, trusted.lesson);
  }, type);
}
