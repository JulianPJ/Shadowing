/**
 * What to search a subtitle directory for, inferred from a video's title, address or file name,
 * and which of an entry's files fits the episode best.
 */
export type SubtitleQuery = { query: string; alternatives: string[]; episode: number | null };
export type SubtitleFile = { url: string; name: string; size: number; last_modified: string };
export type RankedFile = SubtitleFile & { episode: number | null; matches: boolean };

const SUBTITLE = /\.(srt|ass|ssa|vtt)$/i;
const ARCHIVE = /\.(zip|rar|7z|tar|gz)$/i;
const MEDIA = /\.(mp4|m4v|mkv|webm|mov|avi|mp3|m4a|aac|wav|ogg|oga|ogv|flac)$/i;
const NOISE =
  /\b(?:watch|online|free|full|hd|fhd|1080p|720p|480p|english|eng|sub(?:bed|titled|s)?|dub(?:bed)?|raw|stream(?:ing)?|tv series)\b/gi;
const EPISODE_TEXT =
  /(?:\b(?:episode|ep)\.?\s*0*\d{1,4}\b|第\s*0*\d{1,4}\s*[話回]|#\s*0*\d{1,4}\b|\bs\d{1,2}\s*e\d{1,4}\b)/gi;
// Group tags, resolutions, codecs and checksums: "[SubsPlease]", "(1080p)", "【日本語字幕】".
const BRACKETED = /\[[^\]]*\]|\([^)]*\)|【[^】]*】/g;
const ROUTE_WORDS =
  /^(?:watch|anime|video|videos|episode|episodes|play|player|embed|series|title|tv|movie|movies|show|shows|stream|v|e)$/i;

function episodeIn(text: string): number | null {
  const match =
    text.match(/第\s*0*(\d{1,4})\s*[話回]/) ??
    text.match(/\bs\d{1,2}\s*e0*(\d{1,4})\b/i) ??
    text.match(/\b(?:episode|ep)\.?\s*0*(\d{1,4})\b/i) ??
    text.match(/#\s*0*(\d{1,4})\b/) ??
    text.match(/\be0*(\d{1,3})\b/i);
  const episode = match ? Number(match[1]) : NaN;
  return Number.isInteger(episode) && episode > 0 ? episode : null;
}

const tidy = (text: string) =>
  text
    .replace(EPISODE_TEXT, ' ')
    .replace(NOISE, ' ')
    .replace(/[{}「」『』]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Strips a site name, "Watch …" and episode wording from a page title. */
function cleanTitle(title: string, file: boolean) {
  const parts = title
    .replace(BRACKETED, ' ')
    .split(/\s+[|·•–—-]\s+|\s*[|·•]\s*/)
    .map((part) => tidy(file ? part.replace(/\b0*\d{1,3}(?:v\d)?\s*$/, '') : part))
    .filter((part) => part.length >= 2);
  // Page titles end with the site's name ("Watch Hyouka · Miruro"); file names do not.
  const named = parts.length > 1 && !file ? parts.slice(0, -1) : parts;
  return named.reduce((a, b) => (b.length > a.length ? b : a), '');
}

/** A readable slug in a watch address: `/watch/<id>/super-no-ura?ep=8` → "super no ura". */
function slugTitle(url: URL) {
  const readable = url.pathname
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    })
    .filter((segment) => {
      if (ROUTE_WORDS.test(segment) || !/^[\p{L}\d]+(?:[-_][\p{L}\d]+)*$/u.test(segment))
        return false;
      const letters = segment.match(/\p{L}/gu)?.length ?? 0;
      // Identifiers mix case and digits ("7Giys8FWQEEYMdO96HH…"); slugs are words.
      return /[-_]/.test(segment)
        ? letters >= segment.replace(/[-_]/g, '').length * 0.6
        : /^(?:[a-z]{3,}|[^\p{ASCII}]+)$/u.test(segment);
    });
  const slug = readable.at(-1);
  return slug
    ? tidy(slug.replace(/[-_](?:episode|ep)[-_]?\d{1,4}$/i, '').replace(/[-_]+/g, ' '))
    : '';
}

export function subtitleQuery(input: {
  title?: string;
  url?: string;
  fileName?: string;
}): SubtitleQuery {
  let url: URL | null = null;
  try {
    url = input.url ? new URL(input.url) : null;
  } catch {
    url = null;
  }
  const file = !input.title && !!input.fileName;
  const title = (input.title || input.fileName || '').replace(MEDIA, '').replace(/[._]+/g, ' ');
  const fromUrl = url
    ? (['ep', 'episode', 'e']
        .map((name) => Number(url.searchParams.get(name)))
        .find((n) => Number.isInteger(n) && n > 0) ??
      episodeIn(url.pathname.replace(/[-_/]+/g, ' ')))
    : null;
  const episode = fromUrl || (file ? fileEpisode(input.fileName!) : episodeIn(title));
  const candidates = [cleanTitle(title, file), url ? slugTitle(url) : ''].filter(
    (value, index, all) =>
      value.length >= 2 &&
      all.findIndex((other) => other.toLowerCase() === value.toLowerCase()) === index,
  );
  return {
    query: candidates[0] ?? '',
    alternatives: candidates.slice(1),
    episode: episode || null,
  };
}

/** The episode a subtitle or media file's name refers to, if it names one. */
export function fileEpisode(name: string): number | null {
  const base = name.replace(/\.[a-z0-9]{2,4}$/i, '');
  const named = episodeIn(base.replace(/[._]+/g, ' '));
  if (named) return named;
  const dashed = base.match(/\s-\s0*(\d{1,4})(?:v\d)?\b/);
  if (dashed && Number(dashed[1]) > 0) return Number(dashed[1]);
  // "Title 08.srt", "title_08.ja.srt": the last short number outside brackets, not 1080 or x264.
  const loose = [
    ...base.replace(BRACKETED, ' ').matchAll(/(?:^|[\s_.-])0*(\d{1,3})(?:v\d)?(?=$|[\s_.-])/g),
  ]
    .map((match) => Number(match[1]))
    .filter((value) => value > 0);
  return loose.length ? loose.at(-1)! : null;
}

function language(name: string) {
  if (/(?:^|[\W_])(?:ja|jp|jpn|japanese)(?:$|[\W_])|日本語/i.test(name)) return 0;
  if (/(?:^|[\W_])(?:en|eng|english|zh|chs|cht|chinese)(?:$|[\W_])/i.test(name)) return 2;
  return 1;
}

/**
 * An entry's subtitle files, best first: the episode, then Japanese naming, then SRT, then newest.
 * Files that name another episode are left out; archives are only counted.
 */
export function rankSubtitleFiles(files: SubtitleFile[], episode: number | null) {
  const format = (name: string) =>
    ['srt', 'vtt', 'ass', 'ssa'].indexOf(name.toLowerCase().split('.').pop()!);
  const ranked: RankedFile[] = files
    .filter((file) => SUBTITLE.test(file.name))
    .map((file) => {
      const number = fileEpisode(file.name);
      return { ...file, episode: number, matches: !!episode && number === episode };
    })
    .filter((file) => !episode || file.matches || file.episode === null);
  ranked.sort(
    (a, b) =>
      Number(b.matches) - Number(a.matches) ||
      language(a.name) - language(b.name) ||
      format(a.name) - format(b.name) ||
      b.last_modified.localeCompare(a.last_modified),
  );
  return { files: ranked, archives: files.filter((file) => ARCHIVE.test(file.name)).length };
}
