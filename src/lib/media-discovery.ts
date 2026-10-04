import { directMedia, MEDIA_EXTENSIONS, remoteUrl, resolveMediaUrl, UnsupportedMediaError, UNSUPPORTED_MEDIA } from './media';
import type { ResolvedMedia } from './types';

const PAGE_LIMIT = 1_000_000;
function publicPage(url: URL) {
  const host = url.hostname.toLowerCase();
  // Discovery is browser-only; also avoid probing local-network pages and redirects.
  if (!host.includes('.') || host.endsWith('.local') || host.endsWith('.localhost') || host.endsWith('.internal') || host.startsWith('[') || /^\d+\.\d+\.\d+\.\d+$/.test(host)) throw new UnsupportedMediaError(UNSUPPORTED_MEDIA);
}
function candidateUrl(value: string, base: string, mime?: string): string | null {
  try {
    const url = remoteUrl(new URL(value, base).href);
    publicPage(url);
    if (MEDIA_EXTENSIONS.test(url.pathname) || mime && /^(video|audio)\//i.test(mime) && document.createElement('video').canPlayType(mime)) return url.href;
  } catch { /* Unsupported metadata is ignored, never rendered or executed. */ }
  return null;
}
export function extractPageMedia(html: string, pageUrl: string): { url: string; title?: string; author?: string } | null {
  if (html.length > PAGE_LIMIT) throw new UnsupportedMediaError(UNSUPPORTED_MEDIA);
  // An unattached template is inert: scripts, iframe documents and media never run/load.
  const template = document.createElement('template'); template.innerHTML = html;
  const root = template.content;
  const title = (root.querySelector('meta[property="og:title"]')?.getAttribute('content') || root.querySelector('title')?.textContent || '').trim().slice(0, 500);
  const author = (root.querySelector('meta[name="author"]')?.getAttribute('content') || '').trim().slice(0, 300);
  const candidates: { value: string; mime?: string }[] = [];
  for (const element of root.querySelectorAll('video[src], audio[src], video source[src], audio source[src]')) candidates.push({ value: element.getAttribute('src') || '', mime: element.getAttribute('type') || undefined });
  const ogMime = root.querySelector('meta[property="og:video:type"]')?.getAttribute('content') || undefined;
  for (const element of root.querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]')) candidates.push({ value: element.getAttribute('content') || '', mime: ogMime });
  const walk = (value: unknown, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 8) return;
    if (Array.isArray(value)) { value.forEach(item => walk(item, depth + 1)); return; }
    const row = value as Record<string, unknown>;
    if ((row['@type'] === 'VideoObject' || row['@type'] === 'AudioObject') && typeof row.contentUrl === 'string') candidates.push({ value: row.contentUrl, mime: typeof row.encodingFormat === 'string' ? row.encodingFormat : undefined });
    Object.values(row).forEach(item => walk(item, depth + 1));
  };
  for (const script of root.querySelectorAll('script[type="application/ld+json"]')) {
    try { walk(JSON.parse(script.textContent || '')); } catch { /* Malformed optional metadata. */ }
  }
  for (const candidate of candidates) {
    const url = candidateUrl(candidate.value, pageUrl, candidate.mime);
    if (url) return { url, ...(title ? { title } : {}), ...(author ? { author } : {}) };
  }
  return null;
}
export async function resolveMediaLink(input: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<ResolvedMedia> {
  try { return await resolveMediaUrl(input); } catch (error) { if (!(error instanceof UnsupportedMediaError)) throw error; }
  const page = remoteUrl(input); publicPage(page);
  try {
    const response = await fetchImpl(page.href, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000), mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    if (!response.ok) { await response.body?.cancel(); throw new UnsupportedMediaError(UNSUPPORTED_MEDIA); }
    const mime = response.headers.get('content-type')?.split(';')[0].trim() || '';
    if (/^(audio|video)\//.test(mime) && document.createElement('video').canPlayType(mime)) {
      await response.body?.cancel();
      return { originalUrl: input, media: await directMedia(page.href) };
    }
    if (mime !== 'text/html' || !response.body) { await response.body?.cancel(); throw new UnsupportedMediaError(UNSUPPORTED_MEDIA); }
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let size = 0; let html = '';
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > PAGE_LIMIT) { await reader.cancel(); throw new UnsupportedMediaError(UNSUPPORTED_MEDIA); }
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally { reader.releaseLock(); }
    const found = extractPageMedia(html, page.href);
    if (found) return { originalUrl: input, media: await directMedia(found.url, page.href), title: found.title, author: found.author };
  } catch { if (signal?.aborted) throw signal.reason; }
  throw new UnsupportedMediaError(UNSUPPORTED_MEDIA);
}
