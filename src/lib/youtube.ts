export function parseYouTubeUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error('Paste a complete YouTube video URL, including https://.');
  }
  if (!['https:', 'http:'].includes(url.protocol))
    throw new Error('Use an http or https YouTube video URL.');
  const host = url.hostname.toLowerCase();
  let id: string | null = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (
    [
      'youtube.com',
      'www.youtube.com',
      'm.youtube.com',
      'music.youtube.com',
      'www.youtube-nocookie.com',
      'youtube-nocookie.com',
    ].includes(host)
  ) {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split('/')[2];
  } else
    throw new Error(
      'This link is not from YouTube. You can import your own audio or video instead.',
    );
  if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id))
    throw new Error(
      'This link does not identify a video. Paste a watch, Shorts, or youtu.be link.',
    );
  return id;
}
export function timestamp(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return s >= 3600
    ? `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
