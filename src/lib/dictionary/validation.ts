import type { DictionaryMediaType, DictionarySaveInput } from './types';

export class DictionaryValidationError extends Error {}

function requiredText(value: unknown, max: number, label: string) {
  if (typeof value !== 'string') throw new DictionaryValidationError(`Invalid ${label}`);
  const text = value.trim();
  if (!text || text.length > max) throw new DictionaryValidationError(`Invalid ${label}`);
  return text;
}

function optionalText(value: unknown, max: number, label: string) {
  if (value === null || value === undefined || value === '') return null;
  return requiredText(value, max, label);
}

export function normalizeDictionaryTerm(term: string) {
  return term.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
}

function safeMediaUrl(value: unknown, type: DictionaryMediaType, mediaId: string | null) {
  if (value === null || value === undefined || value === '') return null;
  const text = requiredText(value, 2000, 'media URL');
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new DictionaryValidationError('Invalid media URL');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash)
    throw new DictionaryValidationError('Invalid media URL');
  if (
    type === 'youtube' &&
    (!mediaId ||
      url.protocol !== 'https:' ||
      url.hostname !== 'www.youtube.com' ||
      url.pathname !== '/watch' ||
      url.searchParams.get('v') !== mediaId ||
      [...url.searchParams.keys()].some((key) => key !== 'v'))
  )
    throw new DictionaryValidationError('Invalid YouTube locator');
  if (
    type === 'vimeo' &&
    (!mediaId ||
      url.protocol !== 'https:' ||
      url.hostname !== 'player.vimeo.com' ||
      url.pathname !== `/video/${mediaId}` ||
      [...url.searchParams.keys()].some((key) => key !== 'h'))
  )
    throw new DictionaryValidationError('Invalid Vimeo locator');
  // Direct media can contain expiring/sensitive query strings. Those are deliberately never stored.
  if (type === 'direct' && url.search)
    throw new DictionaryValidationError('Unsafe direct-media locator');
  return url.href;
}

export function validateDictionarySaveInput(value: unknown): DictionarySaveInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new DictionaryValidationError('Invalid dictionary record');
  const raw = value as Record<string, unknown>;
  if (raw.schemaVersion !== 1) throw new DictionaryValidationError('Invalid dictionary version');
  const sourceRaw = raw.source;
  if (!sourceRaw || typeof sourceRaw !== 'object' || Array.isArray(sourceRaw))
    throw new DictionaryValidationError('Invalid source');
  const source = sourceRaw as Record<string, unknown>;
  const mediaType = requiredText(source.mediaType, 20, 'media type') as DictionaryMediaType;
  if (!['youtube', 'vimeo', 'direct', 'local', 'demo'].includes(mediaType))
    throw new DictionaryValidationError('Invalid media type');
  const mediaId = optionalText(source.mediaId, 200, 'media ID');
  if (
    (mediaType === 'youtube' && (!mediaId || !/^[\w-]{11}$/.test(mediaId))) ||
    (mediaType === 'vimeo' && (!mediaId || !/^[1-9]\d{0,11}$/.test(mediaId)))
  )
    throw new DictionaryValidationError('Invalid provider media ID');
  if (['local', 'demo', 'direct'].includes(mediaType) && mediaId)
    throw new DictionaryValidationError('Unexpected provider media ID');
  const start = source.start;
  const end = source.end;
  if (
    typeof start !== 'number' ||
    typeof end !== 'number' ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    end <= start ||
    end > 86400
  )
    throw new DictionaryValidationError('Invalid source timing');
  const transcriptKey = requiredText(source.transcriptKey, 64, 'transcript key');
  if (!/^[a-f0-9]{64}$/.test(transcriptKey))
    throw new DictionaryValidationError('Invalid transcript key');
  const mediaContentKey = optionalText(source.mediaContentKey, 200, 'content key');
  if (
    mediaContentKey &&
    !/^(youtube:[\w-]{11}|vimeo:[1-9]\d{0,11}|direct:[a-f0-9]{64})$/.test(mediaContentKey)
  )
    throw new DictionaryValidationError('Invalid media content key');
  return {
    schemaVersion: 1,
    term: requiredText(raw.term, 120, 'term'),
    reading: optionalText(raw.reading, 240, 'reading'),
    translation: requiredText(raw.translation, 2000, 'translation'),
    sourceSentence: requiredText(raw.sourceSentence, 5000, 'source sentence'),
    sourceSentenceTranslation: requiredText(
      raw.sourceSentenceTranslation,
      10000,
      'source sentence translation',
    ),
    source: {
      lessonId: requiredText(source.lessonId, 500, 'lesson ID'),
      segmentId: requiredText(source.segmentId, 500, 'segment ID'),
      lessonTitle: requiredText(source.lessonTitle, 500, 'lesson title'),
      lessonAuthor: requiredText(source.lessonAuthor, 500, 'lesson author'),
      mediaType,
      mediaId,
      mediaUrl: safeMediaUrl(source.mediaUrl, mediaType, mediaId),
      mediaContentKey,
      transcriptKey,
      start,
      end,
    },
  };
}
