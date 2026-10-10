import { canonicalUrl, type Video } from '../../src/lib/discover/types';
export const discoveryNow = Date.parse('2026-10-08T10:20:00.000Z');
export function discoveryVideo(index = 0, changes: Partial<Video> = {}): Video {
  const videoId = `video${String(index).padStart(6, '0')}`;
  return {
    videoId,
    canonicalUrl: canonicalUrl(videoId),
    title: `日本の朝の会話 ${index}`,
    channelId: `creator-${index % 12}`,
    channelTitle: `Japanese creator ${index % 12}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    durationSeconds: 540,
    description: '日本語の日常会話です。',
    publishedAt: '2026-10-01T00:00:00.000Z',
    fetchedAt: '2026-10-08T09:00:00.000Z',
    expiresAt: '2026-10-15T09:00:00.000Z',
    indexedAt: '2026-10-08T09:00:00.000Z',
    topics: ['everyday'],
    captionFlag: true,
    embeddable: true,
    status: 'available',
    regionAllowed: [],
    regionBlocked: [],
    audience: null,
    prepared: false,
    band: null,
    speed: null,
    proof: null,
    popularity: null,
    ...changes,
  };
}
export function youtubeMetadata(id: string, changes: Record<string, unknown> = {}) {
  return {
    id,
    snippet: {
      title: '日本の朝',
      channelId: 'creator',
      channelTitle: 'Daily Japan',
      publishedAt: '2026-10-01T00:00:00Z',
      description: '日本語',
      liveBroadcastContent: 'none',
      thumbnails: { high: { url: `https://i.ytimg.com/vi/${id}/hqdefault.jpg` } },
    },
    contentDetails: { duration: 'PT9M', caption: 'true' },
    status: { privacyStatus: 'public', embeddable: true },
    ...changes,
  };
}
