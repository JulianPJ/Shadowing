import { readBoundedText } from '../http-body';
import { TOPICS, canonicalUrl, validVideoId, type Topic, type Video } from './types';
export class YoutubeDataError extends Error {
  constructor(readonly code: 'quota' | 'unavailable' | 'invalid-response') {
    super(code);
  }
}
export function parseDuration(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const match = /^P(?:(\d+)D)?T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(value);
  if (!match || !match.slice(1).some(Boolean)) return null;
  const seconds =
    Number(match[1] ?? 0) * 86400 +
    Number(match[2] ?? 0) * 3600 +
    Number(match[3] ?? 0) * 60 +
    Number(match[4] ?? 0);
  return seconds > 0 && seconds <= 14400 ? seconds : null;
}
// Only emit fixed labels and explicitly known network codes. Never log raw
// exception messages/stacks/causes: fetch errors can include request details.
const SAFE_FETCH_ERROR_NAMES = new Set([
  'TypeError',
  'AbortError',
  'TimeoutError',
  'NetworkError',
  'Error',
]);
const SAFE_FETCH_CAUSE_CODES = new Set([
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
export function youtubeFetchFailureDetails(error: unknown, signal: AbortSignal) {
  const name = error instanceof Error ? error.name : undefined;
  const errorType = name && SAFE_FETCH_ERROR_NAMES.has(name) ? name : 'UnknownError';
  const signalReason = signal.aborted ? signal.reason : undefined;
  const timeout =
    (signalReason instanceof Error && signalReason.name === 'TimeoutError') ||
    (!signal.aborted && name === 'TimeoutError');
  const failureKind = timeout
    ? 'timeout'
    : signal.aborted || name === 'AbortError'
      ? 'aborted'
      : 'network';
  const cause = error instanceof Error ? error.cause : null;
  const rawCode = cause && typeof cause === 'object' && 'code' in cause ? cause.code : undefined;
  const causeCode =
    typeof rawCode === 'string' && SAFE_FETCH_CAUSE_CODES.has(rawCode) ? rawCode : undefined;
  return { failureKind, errorType, ...(causeCode ? { causeCode } : {}) };
}
const object = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
export function thumbnailUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' &&
      ['i.ytimg.com', 'img.youtube.com'].includes(url.hostname) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
export function youtubeDataApi(
  key: string,
  fetchImpl: typeof fetch = fetch,
  spend: (units: number) => Promise<boolean> = async () => true,
) {
  async function request(
    endpoint: 'search' | 'videos',
    params: Record<string, string>,
    units: number,
  ) {
    if (!key || !(await spend(units))) {
      console.info(JSON.stringify({ event: 'discover.youtube.budget', endpoint, units }));
      throw new YoutubeDataError('quota');
    }
    const url = new URL(`https://www.googleapis.com/youtube/v3/${endpoint}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    const timeoutSignal = AbortSignal.timeout(10000);
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { 'X-Goog-Api-Key': key },
        signal: timeoutSignal,
        redirect: 'error',
      });
    } catch (error) {
      console.info(
        JSON.stringify({
          event: 'discover.youtube.network_error',
          endpoint,
          ...youtubeFetchFailureDetails(error, timeoutSignal),
        }),
      );
      throw new YoutubeDataError('unavailable');
    }
    if (!response.ok) {
      // Only expose bounded, allowlisted Google error codes. Never log credentials,
      // request URLs, arbitrary upstream messages or response bodies.
      let reason: string | undefined;
      try {
        const error = object(object(JSON.parse(await readBoundedText(response, 4096))).error);
        const detail = Array.isArray(error.errors) ? object(error.errors[0]) : {};
        const rawReason = detail.reason ?? error.status;
        if (typeof rawReason === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(rawReason)) {
          reason = rawReason;
        }
      } catch {
        await response.body?.cancel().catch(() => {});
      }
      console.info(
        JSON.stringify({
          event: 'discover.youtube.http_error',
          endpoint,
          status: response.status,
          ...(reason ? { reason } : {}),
        }),
      );
      throw new YoutubeDataError([403, 429].includes(response.status) ? 'quota' : 'unavailable');
    }
    try {
      const json = object(JSON.parse(await readBoundedText(response, 512000)));
      if (!Array.isArray(json.items) || json.items.length > 50) throw new Error();
      return json.items;
    } catch {
      throw new YoutubeDataError('invalid-response');
    }
  }
  return {
    async search(
      query: string,
      order: 'relevance' | 'date' | 'viewCount' = 'relevance',
    ): Promise<string[]> {
      if (
        !query.trim() ||
        query.length > 160 ||
        !['relevance', 'date', 'viewCount'].includes(order)
      )
        throw new Error('Invalid seed');
      const items = await request(
        'search',
        {
          // search.list documents "snippet" as the supported part; video IDs
          // remain available on each search result's id object.
          part: 'snippet',
          q: query,
          order,
          type: 'video',
          relevanceLanguage: 'ja',
          regionCode: 'JP',
          videoEmbeddable: 'true',
          videoSyndicated: 'true',
          safeSearch: 'moderate',
          maxResults: '50',
        },
        100,
      );
      return [...new Set(items.map((i) => object(object(i).id).videoId).filter(validVideoId))];
    },
    async videos(ids: string[], topics: Topic[] = [], now = Date.now()): Promise<Video[]> {
      if (!ids.length) return [];
      if (
        ids.length > 50 ||
        ids.some((id) => !validVideoId(id)) ||
        topics.some((t) => !(t in TOPICS))
      )
        throw new Error('Invalid metadata batch');
      const items = await request(
        'videos',
        {
          part: 'snippet,contentDetails,status',
          id: [...new Set(ids)].join(','),
          maxResults: '50',
        },
        1,
      );
      const result: Video[] = [];
      for (const value of items) {
        const item = object(value),
          snippet = object(item.snippet),
          status = object(item.status),
          details = object(item.contentDetails);
        const id = item.id,
          duration = parseDuration(details.duration);
        if (
          !validVideoId(id) ||
          !ids.includes(id) ||
          !duration ||
          status.privacyStatus !== 'public' ||
          status.embeddable !== true ||
          snippet.liveBroadcastContent !== 'none' ||
          (details.contentRating && object(details.contentRating).ytRating === 'ytAgeRestricted') ||
          !Number.isFinite(Date.parse(String(snippet.publishedAt)))
        )
          continue;
        const title = text(snippet.title, 500),
          channelId = text(snippet.channelId, 100),
          channelTitle = text(snippet.channelTitle, 300);
        if (!title || !channelId || !channelTitle) continue;
        const thumbnails = object(snippet.thumbnails);
        const thumb =
          thumbnailUrl(object(thumbnails.high).url) ??
          thumbnailUrl(object(thumbnails.medium).url) ??
          thumbnailUrl(object(thumbnails.default).url);
        const region = object(details.regionRestriction);
        const regions = (v: unknown) =>
          Array.isArray(v)
            ? v
                .filter((x): x is string => typeof x === 'string' && /^[A-Z]{2}$/.test(x))
                .slice(0, 250)
            : [];
        result.push({
          videoId: id,
          canonicalUrl: canonicalUrl(id),
          title,
          channelId,
          channelTitle,
          thumbnailUrl: thumb,
          durationSeconds: duration,
          description: text(snippet.description, 1000),
          publishedAt: new Date(String(snippet.publishedAt)).toISOString(),
          captionFlag: details.caption === 'true',
          embeddable: true,
          status: 'available',
          regionAllowed: regions(region.allowed),
          regionBlocked: regions(region.blocked),
          fetchedAt: new Date(now).toISOString(),
          expiresAt: new Date(now + 7 * 86400000).toISOString(),
          indexedAt: new Date(now).toISOString(),
          topics,
          prepared: false,
          band: null,
          speed: null,
          proof: null,
          audience: null,
          popularity: null,
        });
      }
      return result;
    },
  };
}
