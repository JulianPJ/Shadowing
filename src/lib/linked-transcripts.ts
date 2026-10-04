import { sha256 } from './media';
import { validateCues } from './segmentation';
import type { Cue, LinkedMediaSource, TranscriptSource } from './types';
import { type D1Database, storageEvent } from './d1';

export type StoredLinkedMediaIdentity = {
  schemaVersion: 1; contentKey: string; mediaType: 'youtube' | 'vimeo' | 'direct';
  provider?: 'youtube' | 'vimeo'; providerMediaId?: string;
};
export function validContentKey(value: unknown): value is string {
  return typeof value === 'string' && /^(youtube:[\w-]{11}|vimeo:[1-9]\d{0,11}|direct:[a-f0-9]{64})$/.test(value);
}
export function storedMediaIdentity(media: LinkedMediaSource): StoredLinkedMediaIdentity {
  return { schemaVersion: 1, contentKey: media.contentKey, mediaType: media.type,
    ...(media.type === 'direct' ? {} : { provider: media.provider, providerMediaId: media.videoId }) };
}

export type StoredTranscript = {
  schemaVersion: 1; contentKey: string; media: StoredLinkedMediaIdentity; language: 'ja';
  source: TranscriptSource; cues: Cue[]; transcriptHash: string; createdAt: string;
  visibility: 'private' | 'shared' | 'system'; generatorVersion?: string; model?: string; ownerId?: string;
};
export interface LinkedTranscriptRepository {
  lookup(input: { contentKey: string; language: 'ja' }): Promise<StoredTranscript | null>;
  save(input: StoredTranscript): Promise<void>;
}
export const linkedTranscripts: LinkedTranscriptRepository = {
  async lookup() { return null; }, async save() { /* Ordinary Next development has no hosted binding. */ },
};
export async function validateStoredTranscript(input: StoredTranscript): Promise<StoredTranscript> {
  const { media, source } = input;
  if (input.schemaVersion !== 1 || !validContentKey(input.contentKey) || input.language !== 'ja' ||
      !['system', 'shared'].includes(input.visibility) || input.ownerId !== undefined ||
      !media || media.schemaVersion !== 1 || media.contentKey !== input.contentKey ||
      Object.keys(media).some(key => !['schemaVersion', 'contentKey', 'mediaType', 'provider', 'providerMediaId'].includes(key)) ||
      !['youtube', 'vimeo', 'direct'].includes(media.mediaType) ||
      (media.mediaType === 'direct' ? (media.provider !== undefined || media.providerMediaId !== undefined || !input.contentKey.startsWith('direct:')) :
        (media.provider !== media.mediaType || input.contentKey !== `${media.mediaType}:${media.providerMediaId}`)) ||
      !source || source.schemaVersion !== 1 || source.language !== 'ja' || source.normalizationVersion !== 1 || source.segmentationVersion !== 1 ||
      !['provider-captions', 'generated'].includes(source.type) ||
      (source.type === 'generated' && !input.generatorVersion) ||
      typeof source.provenance !== 'string' || !/^[\w .()+-]{1,150}$/.test(source.provenance) ||
      (source.provider !== undefined && (typeof source.provider !== 'string' || !/^[\w .()+-]{1,150}$/.test(source.provider))) ||
      (input.generatorVersion !== undefined && !/^[\w-]{1,100}$/.test(input.generatorVersion)) ||
      (input.model !== undefined && !/^[@\w./:+-]{1,150}$/.test(input.model)) ||
      typeof input.createdAt !== 'string' || !Number.isFinite(Date.parse(input.createdAt))) throw new Error('Invalid shared transcript');
  const cues = validateCues(input.cues), hash = await transcriptHash(cues);
  if (input.transcriptHash !== hash || source.transcriptHash !== hash) throw new Error('Invalid transcript revision');
  return { ...input, media: { ...media }, source: { schemaVersion: 1, type: source.type, language: 'ja', provenance: source.provenance,
    provider: source.provider, transcriptHash: hash, normalizationVersion: 1, segmentationVersion: 1 }, cues };
}
export function createD1LinkedTranscriptRepository(db: D1Database): LinkedTranscriptRepository {
  return {
    async lookup({ contentKey, language }) {
      if (!validContentKey(contentKey) || language !== 'ja') return null;
      const row = await db.prepare(`SELECT * FROM linked_transcripts WHERE content_key = ? AND language = ?
        AND visibility IN ('system','shared') AND owner_user_id IS NULL
        AND source_type IN ('provider-captions','generated') AND schema_version = 1
        AND normalization_version = 1 AND segmentation_version = 1 ORDER BY created_at DESC, storage_key DESC LIMIT 1`).bind(contentKey, language).first<Record<string, unknown>>();
      if (!row) return null;
      try {
        return await validateStoredTranscript({ schemaVersion: row.schema_version, contentKey: row.content_key,
          media: { schemaVersion: 1, contentKey: row.content_key, mediaType: row.media_type, ...(row.provider ? { provider: row.provider, providerMediaId: row.provider_media_id } : {}) },
          language: row.language, source: { schemaVersion: 1, type: row.source_type, language: row.language, provenance: row.provenance,
            ...(row.source_provider ? { provider: row.source_provider } : {}), transcriptHash: row.transcript_hash, normalizationVersion: row.normalization_version, segmentationVersion: row.segmentation_version },
          cues: JSON.parse(row.cues_json as string), transcriptHash: row.transcript_hash, createdAt: row.created_at, visibility: row.visibility,
          ...(row.generator_version ? { generatorVersion: row.generator_version } : {}), ...(row.model ? { model: row.model } : {}),
        } as StoredTranscript);
      } catch { storageEvent('d1.transcript.invalid'); return null; }
    },
    async save(input) {
      const safe = await validateStoredTranscript(input);
      const key = await sha256(JSON.stringify([safe.contentKey, safe.language, safe.transcriptHash, safe.source.type, safe.source.provenance, safe.visibility, safe.generatorVersion ?? '', 1, 1, 1]));
      await db.prepare(`INSERT INTO linked_transcripts (storage_key,schema_version,content_key,media_type,provider,provider_media_id,language,transcript_hash,
        source_type,provenance,source_provider,visibility,normalization_version,segmentation_version,cues_json,generator_version,model,owner_user_id,created_at)
        VALUES (?,1,?,?,?,?,?,?,?,?,?,?,1,1,?,?,?,NULL,?) ON CONFLICT(storage_key) DO UPDATE SET cues_json=excluded.cues_json,
        transcript_hash=excluded.transcript_hash,source_type=excluded.source_type,visibility=excluded.visibility,
        normalization_version=excluded.normalization_version,segmentation_version=excluded.segmentation_version
        WHERE linked_transcripts.cues_json != excluded.cues_json OR linked_transcripts.transcript_hash != excluded.transcript_hash
        OR linked_transcripts.source_type != excluded.source_type OR linked_transcripts.visibility != excluded.visibility
        OR linked_transcripts.normalization_version != excluded.normalization_version OR linked_transcripts.segmentation_version != excluded.segmentation_version`)
        .bind(key, safe.contentKey, safe.media.mediaType, safe.media.provider ?? null, safe.media.providerMediaId ?? null, safe.language, safe.transcriptHash,
          safe.source.type, safe.source.provenance, safe.source.provider ?? null, safe.visibility, JSON.stringify(safe.cues), safe.generatorVersion ?? null, safe.model ?? null, safe.createdAt).run();
    },
  };
}
// Contract only. A future implementation needs an approved audio-access path first.
export interface GeneratedTranscriptProvider {
  transcribe(input: LinkedMediaSource, signal: AbortSignal): Promise<{ cues: Cue[]; source: TranscriptSource; generatorVersion: string; model?: string }>;
}
export async function transcriptHash(cues: Cue[]) {
  return sha256(JSON.stringify(validateCues(cues).map(({ start, end, text, translation, estimated }) => ({ start, end, text, translation, estimated }))));
}
export function needsUserTranscript(code: unknown) { return code === 'no-japanese-captions' || code === 'no-caption-provider'; }
