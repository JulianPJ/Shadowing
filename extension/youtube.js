// Shared identity for YouTube videos, independent of page HTML <video> elements.
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

export function canonicalYouTubeUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  let id = null;
  if (url.hostname === 'youtu.be') {
    id = url.pathname.match(/^\/([\w-]{11})\/?$/)?.[1] ?? null;
  } else if (YOUTUBE_HOSTS.has(url.hostname)) {
    if (url.pathname === '/watch') {
      id = url.searchParams.get('v');
    } else {
      id = url.pathname.match(/^\/(?:shorts|embed|live)\/([\w-]{11})\/?$/)?.[1] ?? null;
    }
  }

  return id && /^[\w-]{11}$/.test(id) ? 'https://www.youtube.com/watch?v=' + id : null;
}

