import { sha256 } from './hash';
import { type D1Database, storageEvent } from './d1';
import { validContentKey } from './linked-transcripts';
import { validateQuiz } from './quiz';
import { validateDifficultyAnalysis } from './difficulty';
import type { ContentDifficultyAnalysis, LessonQuiz, QuizLesson } from './types';

export const QUIZ_GENERATOR_VERSION = 'quiz-content-v1';
export const DIFFICULTY_GENERATOR_VERSION = 'difficulty-fullcoverage-v1';
export type ArtifactType = 'quiz' | 'difficulty';
export type ArtifactLookup = {
  contentKey: string;
  transcriptKey: string;
  artifactType: ArtifactType;
  schemaVersion: number;
  generatorVersion: string;
};
export type StoredGeneratedArtifact = ArtifactLookup & {
  sourceTranscriptHash: string;
  payload: unknown;
  payloadId: string;
  createdAt: string;
};
export interface GeneratedArtifactRepository {
  lookup(input: ArtifactLookup): Promise<StoredGeneratedArtifact | null>;
  save(input: StoredGeneratedArtifact, lesson: QuizLesson): Promise<void>;
}
export const generatedArtifacts: GeneratedArtifactRepository = {
  async lookup() {
    return null;
  },
  async save() {},
};
function validateIdentity(input: ArtifactLookup) {
  if (
    !validContentKey(input.contentKey) ||
    !/^[a-f0-9]{64}$/.test(input.transcriptKey) ||
    !['quiz', 'difficulty'].includes(input.artifactType) ||
    input.schemaVersion !== 1 ||
    !/^[\w-]{1,100}$/.test(input.generatorVersion)
  )
    throw new Error('Invalid artifact identity');
}
export async function validateArtifactPayload(
  type: ArtifactType,
  payload: unknown,
  lesson: QuizLesson,
): Promise<LessonQuiz | ContentDifficultyAnalysis> {
  return type === 'quiz'
    ? validateQuiz(payload, lesson)
    : validateDifficultyAnalysis(payload, lesson);
}
export function createD1GeneratedArtifactRepository(db: D1Database): GeneratedArtifactRepository {
  return {
    async lookup(input) {
      validateIdentity(input);
      const row = await db
        .prepare(
          `SELECT * FROM generated_artifacts WHERE content_key=? AND transcript_key=? AND artifact_type=? AND schema_version=? AND generator_version=?`,
        )
        .bind(
          input.contentKey,
          input.transcriptKey,
          input.artifactType,
          input.schemaVersion,
          input.generatorVersion,
        )
        .first<Record<string, unknown>>();
      if (!row) return null;
      try {
        const payload = JSON.parse(row.payload_json as string);
        if (
          !/^[a-f0-9]{64}$/.test(row.source_transcript_hash as string) ||
          !Number.isFinite(Date.parse(row.created_at as string)) ||
          !payload ||
          payload.id !== row.payload_id ||
          payload.transcriptKey !== input.transcriptKey ||
          payload.schemaVersion !== input.schemaVersion
        )
          throw new Error('Invalid artifact');
        return {
          ...input,
          sourceTranscriptHash: row.source_transcript_hash as string,
          payload,
          payloadId: row.payload_id as string,
          createdAt: row.created_at as string,
        };
      } catch {
        storageEvent('d1.artifact.invalid', input.artifactType);
        return null;
      }
    },
    async save(input, lesson) {
      validateIdentity(input);
      const payload = await validateArtifactPayload(input.artifactType, input.payload, lesson);
      if (
        payload.id !== input.payloadId ||
        payload.transcriptKey !== input.transcriptKey ||
        !/^[a-f0-9]{64}$/.test(input.sourceTranscriptHash) ||
        !Number.isFinite(Date.parse(input.createdAt))
      )
        throw new Error('Invalid artifact');
      const id = await sha256(
        JSON.stringify([
          input.contentKey,
          input.transcriptKey,
          input.artifactType,
          input.schemaVersion,
          input.generatorVersion,
        ]),
      );
      // Repair an invalid payload on a miss; repeat logical saves don't add rows.
      await db
        .prepare(
          `INSERT INTO generated_artifacts (id,content_key,transcript_key,source_transcript_hash,artifact_type,schema_version,generator_version,payload_id,payload_json,created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT
        DO UPDATE SET content_key=excluded.content_key,transcript_key=excluded.transcript_key,artifact_type=excluded.artifact_type,
        schema_version=excluded.schema_version,generator_version=excluded.generator_version,
        payload_id=excluded.payload_id,payload_json=excluded.payload_json,source_transcript_hash=excluded.source_transcript_hash,created_at=excluded.created_at
        WHERE generated_artifacts.payload_json != excluded.payload_json OR generated_artifacts.generator_version != excluded.generator_version
        OR generated_artifacts.transcript_key != excluded.transcript_key OR generated_artifacts.source_transcript_hash != excluded.source_transcript_hash`,
        )
        .bind(
          id,
          input.contentKey,
          input.transcriptKey,
          input.sourceTranscriptHash,
          input.artifactType,
          input.schemaVersion,
          input.generatorVersion,
          payload.id,
          JSON.stringify(payload),
          input.createdAt,
        )
        .run();
    },
  };
}
