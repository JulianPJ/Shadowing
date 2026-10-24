import { readStorage, writeStorage } from '../storage/browser';
import { decodeSubtitleBytes } from '../subtitles';
import type { SubtitleFile } from './match';

/**
 * Jimaku (jimaku.cc), a directory of Japanese subtitles for anime and drama. Requests go from the
 * learner's browser with their own API key: Jimaku limits each address, and the key never
 * reaches Hibiki's server.
 */
export const JIMAKU = 'https://jimaku.cc';
export const JIMAKU_ACCOUNT = `${JIMAKU}/account`;
const STORAGE_KEY = 'subtitle-sources';
const CHANGE = 'hibiki:subtitle-sources-change';
const MAX_BYTES = 2 * 1024 * 1024;

export type JimakuEntry = {
  id: number;
  name: string;
  english_name?: string | null;
  japanese_name?: string | null;
  anilist_id?: number | null;
  flags?: { anime?: boolean; movie?: boolean; adult?: boolean };
  last_modified: string;
};
type SubtitleSources = { jimaku?: { key: string; savedAt: string } };

export class JimakuError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** The learner's Jimaku key on this device, for the signed-in account (or this browser). */
export function jimakuKey(): string | null {
  const key = readStorage<SubtitleSources>(STORAGE_KEY, {}).jimaku?.key;
  return typeof key === 'string' && validKey(key) ? key : null;
}
export function validKey(key: string) {
  return /^[!-~]{8,256}$/.test(key);
}
export function saveJimakuKey(key: string) {
  writeStorage(STORAGE_KEY, { jimaku: { key, savedAt: new Date().toISOString() } });
  window.dispatchEvent(new Event(CHANGE));
}
export function removeJimakuKey() {
  writeStorage(STORAGE_KEY, {});
  window.dispatchEvent(new Event(CHANGE));
}
/** Calls `listener` when the key changes in this or another tab, or the account switches. */
export function onJimakuKeyChange(listener: () => void) {
  const events = [CHANGE, 'hibiki:account-change', 'storage'];
  for (const event of events) window.addEventListener(event, listener);
  return () => {
    for (const event of events) window.removeEventListener(event, listener);
  };
}

async function api<T>(path: string, key: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${JIMAKU}/api${path}`, {
      headers: { Authorization: key, 'X-Client-Id': 'hibiki' },
      cache: 'no-store',
      credentials: 'omit',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new JimakuError('Jimaku could not be reached. Check your connection and try again.');
  }
  if (response.status === 401)
    throw new JimakuError(
      'Jimaku did not accept this API key. Paste the key from your Jimaku account page.',
      401,
    );
  if (response.status === 429) {
    const wait = Number(response.headers.get('x-ratelimit-reset-after'));
    throw new JimakuError(
      `Jimaku is limiting searches for a moment. Try again${wait > 0 ? ` in ${Math.ceil(wait)} seconds` : ' shortly'}.`,
      429,
    );
  }
  if (!response.ok)
    throw new JimakuError(
      'Jimaku is unavailable right now. Try again, or upload subtitles.',
      response.status,
    );
  return (await response.json()) as T;
}

export async function searchJimaku(key: string, query: string, signal?: AbortSignal) {
  const entries = await api<JimakuEntry[]>(
    `/entries/search?${new URLSearchParams({ query: query.trim().slice(0, 200) })}`,
    key,
    signal,
  );
  return Array.isArray(entries) ? entries.filter((entry) => Number.isInteger(entry?.id)) : [];
}
/** Checks a key with one search; throws a `JimakuError` with status 401 when it is refused. */
export async function verifyJimakuKey(key: string, signal?: AbortSignal) {
  await searchJimaku(key, 'hyouka', signal);
}

/** An entry's files; with an episode, Jimaku matches it from the file names. */
export async function jimakuFiles(
  key: string,
  entryId: number,
  episode: number | null,
  signal?: AbortSignal,
) {
  const query = episode ? `?${new URLSearchParams({ episode: String(episode) })}` : '';
  const files = await api<SubtitleFile[]>(`/entries/${entryId}/files${query}`, key, signal);
  return Array.isArray(files)
    ? files.filter(
        (file) => typeof file?.url === 'string' && typeof file.name === 'string' && file.size >= 0,
      )
    : [];
}

/** Downloads a subtitle file (public, no key) and decodes it, including Shift_JIS and UTF-16. */
export async function downloadJimakuFile(file: SubtitleFile, signal?: AbortSignal) {
  const url = new URL(file.url, JIMAKU);
  if (url.origin !== JIMAKU) throw new JimakuError('This Jimaku file link is not on jimaku.cc.');
  if (file.size > MAX_BYTES) throw new JimakuError('This subtitle file is larger than 2 MB.');
  let response: Response;
  try {
    response = await fetch(url, { credentials: 'omit', signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new JimakuError('The subtitle file could not be downloaded. Try again.');
  }
  if (!response.ok) throw new JimakuError('The subtitle file could not be downloaded. Try again.');
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES)
    throw new JimakuError('This subtitle file is larger than 2 MB.');
  return decodeSubtitleBytes(bytes);
}

export function entryUrl(entry: Pick<JimakuEntry, 'id'>) {
  return `${JIMAKU}/entry/${entry.id}`;
}
