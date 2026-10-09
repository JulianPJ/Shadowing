import { sha256 } from './hash';
import { parseYouTubeUrl } from './youtube';
import type {
  Lesson,
  LinkedMediaSource,
  MediaSource,
  PageMediaSource,
  ResolvedMedia,
} from './types';

export const MEDIA_EXTENSIONS = /\.(mp4|m4v|webm|mov|mp3|m4a|aac|wav|ogg|oga|ogv|flac)$/i;
export const MEDIA_ACCEPT =
  'video/*,audio/*,.mp4,.m4v,.webm,.mov,.mp3,.m4a,.aac,.wav,.ogg,.oga,.ogv,.flac';
export const MEDIA_LIMIT = 1024 * 1024 * 1024;
export const UNSUPPORTED_MEDIA =
  'This page does not expose a supported player or an accessible direct media link. Paste a YouTube, Vimeo, or direct audio/video link, or import your own media.';
export class UnsupportedMediaError extends Error {}

export function remoteUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Paste a complete video link, including https://.');
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Use an HTTP(S) video link without embedded login credentials.');
  if (url.href.length > 2000) throw new Error('The video link is too long.');
  url.hash = '';
  return url;
}
export { sha256 } from './hash';
export async function directMedia(
  input: string,
  discoveredFrom?: string,
): Promise<LinkedMediaSource> {
  const canonicalUrl = remoteUrl(input).href;
  // Preserve meaningful/signed queries in playback URLs, never in a readable ID or logs.
  return {
    schemaVersion: 1,
    type: 'direct',
    canonicalUrl,
    contentKey: `direct:${await sha256(canonicalUrl)}`,
    ...(discoveredFrom ? { discoveredFrom } : {}),
  };
}
/** A video on a web page that Hibiki Bridge plays in the page's own tab. */
export async function pageMedia(pageUrl: string): Promise<PageMediaSource> {
  const url = remoteUrl(pageUrl);
  return {
    schemaVersion: 1,
    type: 'page',
    canonicalUrl: url.href,
    pageKey: `page:${await sha256(url.href)}`,
  };
}
// Pure provider registry: no arbitrary server-side URL fetching. Future providers add a resolver + adapter here.
export async function resolveMediaUrl(input: string): Promise<ResolvedMedia> {
  const url = remoteUrl(input);
  const host = url.hostname.toLowerCase();
  if (
    [
      'youtu.be',
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'youtube-nocookie.com',
      'www.youtube-nocookie.com',
    ].includes(host)
  ) {
    const videoId = parseYouTubeUrl(url.href);
    return {
      originalUrl: input,
      media: {
        schemaVersion: 1,
        type: 'youtube',
        provider: 'youtube',
        videoId,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        contentKey: `youtube:${videoId}`,
      },
    };
  }
  if (['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'].includes(host)) {
    const match = url.pathname.match(
      /^\/(?:video\/|channels\/[^/]+\/|groups\/[^/]+\/videos\/)?([1-9]\d{0,11})(?:\/([a-zA-Z0-9]+))?\/?$/,
    );
    if (!match)
      throw new Error('This Vimeo link does not identify a video. Paste a video or player link.');
    const videoId = match[1];
    const accessHash = url.searchParams.get('h') || match[2];
    if (accessHash && !/^[a-zA-Z0-9]{1,64}$/.test(accessHash))
      throw new Error('This Vimeo access link is invalid.');
    const canonicalUrl = `https://player.vimeo.com/video/${videoId}${accessHash ? `?h=${accessHash}` : ''}`;
    return {
      originalUrl: input,
      media: {
        schemaVersion: 1,
        type: 'vimeo',
        provider: 'vimeo',
        videoId,
        canonicalUrl,
        contentKey: `vimeo:${videoId}`,
      },
    };
  }
  if (MEDIA_EXTENSIONS.test(url.pathname))
    return { originalUrl: input, media: await directMedia(url.href) };
  throw new UnsupportedMediaError(UNSUPPORTED_MEDIA);
}
export function validateMediaFile(file: Pick<File, 'size' | 'name' | 'type'>) {
  if (file.size > MEDIA_LIMIT) throw new Error('Please use media smaller than 1 GB.');
  if (
    file.type &&
    file.type !== 'application/octet-stream' &&
    !/^(audio|video)\//i.test(file.type) &&
    !MEDIA_EXTENSIONS.test(file.name)
  )
    throw new Error('Choose a browser-supported audio or video file.');
}
export function lessonMedia(lesson: Lesson): MediaSource {
  if (lesson.mediaSource) return lesson.mediaSource;
  if (lesson.source === 'youtube' && lesson.videoId && /^[\w-]{11}$/.test(lesson.videoId))
    return {
      schemaVersion: 1,
      type: 'youtube',
      provider: 'youtube',
      videoId: lesson.videoId,
      canonicalUrl: `https://www.youtube.com/watch?v=${lesson.videoId}`,
      contentKey: `youtube:${lesson.videoId}`,
    };
  if (lesson.source === 'demo') return { schemaVersion: 1, type: 'demo' };
  if (lesson.source === 'upload')
    return { schemaVersion: 1, type: 'local', fileName: lesson.mediaName || 'Your media' };
  throw new Error('The saved media source could not be read.');
}
export function migrateLesson(lesson: Lesson): Lesson {
  const mediaSource = lessonMedia(lesson);
  if (
    mediaSource.schemaVersion !== 1 ||
    !['youtube', 'vimeo', 'direct', 'page', 'local', 'demo'].includes(mediaSource.type)
  )
    throw new Error('Unsupported media source version.');
  if ((mediaSource.type === 'local' ? 'upload' : mediaSource.type) !== lesson.source)
    throw new Error('The saved media source does not match this lesson.');
  if ('canonicalUrl' in mediaSource) remoteUrl(mediaSource.canonicalUrl);
  if (
    mediaSource.type === 'youtube' &&
    (mediaSource.provider !== 'youtube' ||
      !/^[\w-]{11}$/.test(mediaSource.videoId) ||
      mediaSource.contentKey !== `youtube:${mediaSource.videoId}` ||
      mediaSource.canonicalUrl !== `https://www.youtube.com/watch?v=${mediaSource.videoId}`)
  )
    throw new Error('Invalid saved YouTube source.');
  if (
    mediaSource.type === 'vimeo' &&
    (mediaSource.provider !== 'vimeo' ||
      !/^[1-9]\d{0,11}$/.test(mediaSource.videoId) ||
      mediaSource.contentKey !== `vimeo:${mediaSource.videoId}` ||
      !new RegExp(
        `^https://player\\.vimeo\\.com/video/${mediaSource.videoId}(?:\\?h=[a-zA-Z0-9]{1,64})?$`,
      ).test(mediaSource.canonicalUrl))
  )
    throw new Error('Invalid saved Vimeo source.');
  if (mediaSource.type === 'direct' && !/^direct:[a-f0-9]{64}$/.test(mediaSource.contentKey))
    throw new Error('Invalid saved direct-media identity.');
  if (
    mediaSource.type === 'page' &&
    (!/^page:[a-f0-9]{64}$/.test(mediaSource.pageKey) || 'contentKey' in mediaSource)
  )
    throw new Error('Invalid saved web-page identity.');
  if ((mediaSource.type === 'local' || mediaSource.type === 'demo') && 'contentKey' in mediaSource)
    throw new Error('Local media cannot have a shared content identity.');
  if (
    lesson.transcript &&
    (lesson.transcript.schemaVersion !== 1 || lesson.transcript.language !== 'ja')
  )
    throw new Error('Unsupported transcript source version.');
  return {
    ...lesson,
    mediaSource,
    transcript: lesson.transcript ?? {
      schemaVersion: 1,
      type:
        lesson.source === 'demo'
          ? 'authored'
          : /import|your transcript/i.test(lesson.transcriptSource)
            ? 'user-upload'
            : lesson.source === 'youtube'
              ? 'provider-captions'
              : /whisper/i.test(lesson.transcriptSource)
                ? 'generated'
                : 'user-upload',
      language: 'ja',
      provenance: lesson.transcriptSource,
      normalizationVersion: 1,
      segmentationVersion: 1,
    },
  };
}
export function sourceLabel(lesson: Lesson) {
  return {
    youtube: 'YouTube',
    vimeo: 'Vimeo',
    direct: 'Direct video',
    page: 'Web page',
    local: 'Your media',
    demo: 'Studio sample',
  }[lessonMedia(lesson).type];
}
