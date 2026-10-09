import type { Filters, Video } from './types';
export function durationMatches(seconds: number, duration: Filters['duration']) {
  return (
    duration === 'any' ||
    (duration === 'under5'
      ? seconds < 300
      : duration === '5to10'
        ? seconds >= 300 && seconds <= 600
        : duration === '10to20'
          ? seconds > 600 && seconds <= 1200
          : seconds > 1200)
  );
}
export function eligible(video: Video, filters: Filters, region = 'JP', now = Date.now()) {
  if (
    video.status !== 'available' ||
    !video.embeddable ||
    Date.parse(video.expiresAt) <= now ||
    !Number.isFinite(video.durationSeconds) ||
    video.durationSeconds <= 0
  )
    return false;
  if (
    video.regionBlocked.includes(region) ||
    (video.regionAllowed.length && !video.regionAllowed.includes(region))
  )
    return false;
  if (!['for_you', 'all'].includes(filters.band) && video.band !== filters.band) return false;
  if (filters.topic !== 'all' && !video.topics.includes(filters.topic)) return false;
  if (!durationMatches(video.durationSeconds, filters.duration)) return false;
  if (
    (filters.captions === 'reported' && !video.captionFlag) ||
    (filters.captions === 'prepared' && !video.prepared)
  )
    return false;
  if (filters.audience !== 'any' && video.audience !== filters.audience) return false;
  if (filters.speed !== 'any') {
    if (video.speed === null) return false;
    if (
      (filters.speed === 'slow' && video.speed > 2) ||
      (filters.speed === 'natural' && video.speed !== 3) ||
      (filters.speed === 'fast' && video.speed < 4)
    )
      return false;
  }
  return (
    !filters.q ||
    `${video.title} ${video.channelTitle} ${video.description}`
      .normalize('NFKC')
      .toLowerCase()
      .includes(filters.q.toLowerCase())
  );
}
