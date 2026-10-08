import type { DictionaryQuery } from './types';
import { DictionaryValidationError, normalizeDictionaryTerm } from './validation';
export const DICTIONARY_PAGE_MAX = 100;
export const DICTIONARY_IDS_MAX = 50;
export const dictionaryId = (id: unknown): id is string =>
  typeof id === 'string' && /^[\w-]{1,100}$/.test(id);
export function validateDictionaryIds(ids: unknown): string[] {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > DICTIONARY_IDS_MAX ||
    !ids.every(dictionaryId)
  )
    throw new DictionaryValidationError('Invalid dictionary IDs');
  return [...new Set(ids)];
}
export function dictionaryCursor(createdAt: string, id: string) {
  return btoa(JSON.stringify([1, createdAt, id]));
}
export function parseDictionaryCursor(cursor: string) {
  try {
    if (cursor.length > 400 || !/^[A-Za-z0-9+/=]+$/.test(cursor)) throw new Error();
    const tuple: unknown = JSON.parse(atob(cursor));
    if (
      !Array.isArray(tuple) ||
      tuple.length !== 3 ||
      tuple[0] !== 1 ||
      typeof tuple[1] !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(tuple[1]) ||
      !Number.isFinite(Date.parse(tuple[1])) ||
      new Date(tuple[1]).toISOString() !== tuple[1] ||
      !dictionaryId(tuple[2])
    )
      throw new Error();
    return { createdAt: tuple[1], id: tuple[2] as string };
  } catch {
    throw new DictionaryValidationError('Invalid dictionary cursor');
  }
}
export function validateDictionaryQuery(
  query: DictionaryQuery,
): DictionaryQuery & { limit: number } {
  const limit = query.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > DICTIONARY_PAGE_MAX)
    throw new DictionaryValidationError('Invalid dictionary page size');
  if (query.cursor !== undefined && query.cursor !== null) parseDictionaryCursor(query.cursor);
  for (const id of [query.deckId, query.tagId])
    if (id !== undefined && !dictionaryId(id))
      throw new DictionaryValidationError('Invalid dictionary filter');
  if (query.lessonId !== undefined && (!query.lessonId.trim() || query.lessonId.length > 500))
    throw new DictionaryValidationError('Invalid lesson identity');
  if (
    query.transcriptKey !== undefined &&
    (!query.lessonId || !/^[a-f0-9]{64}$/.test(query.transcriptKey))
  )
    throw new DictionaryValidationError('Invalid transcript identity');
  if (query.term !== undefined && (!query.term.trim() || query.term.length > 120))
    throw new DictionaryValidationError('Invalid dictionary term');
  if (query.search !== undefined && (!query.search.trim() || query.search.length > 120))
    throw new DictionaryValidationError('Invalid dictionary search');
  return {
    ...query,
    limit,
    ...(query.term ? { term: normalizeDictionaryTerm(query.term) } : {}),
    ...(query.search ? { search: normalizeDictionaryTerm(query.search) } : {}),
  };
}
export function dictionaryQueryParams(query: DictionaryQuery) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined && value !== null) params.set(key, String(value));
  return params;
}
export function readDictionaryQuery(params: URLSearchParams) {
  for (const key of params.keys())
    if (
      ![
        'limit',
        'cursor',
        'term',
        'search',
        'deckId',
        'tagId',
        'lessonId',
        'transcriptKey',
        'ids',
      ].includes(key) ||
      params.getAll(key).length !== 1
    )
      throw new DictionaryValidationError('Invalid dictionary query');
  return validateDictionaryQuery({
    ...(params.has('limit') ? { limit: Number(params.get('limit')) } : {}),
    ...Object.fromEntries(
      ['cursor', 'term', 'search', 'deckId', 'tagId', 'lessonId', 'transcriptKey']
        .filter((k) => params.has(k))
        .map((k) => [k, params.get(k)]),
    ),
  });
}
