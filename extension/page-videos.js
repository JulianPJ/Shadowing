// Runs inside each frame of a page: describes its videos, largest first, in the order the
// controller selects them by index. Shared by the popup and by links pasted into Hibiki. Chrome
// serialises it into the page: no outside names.
export function describeVideos() {
  return [...document.querySelectorAll('video')]
    .filter((video) => video.isConnected)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)
    .map((video, index) => ({
      index,
      width: video.clientWidth,
      height: video.clientHeight,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      tracks: [...video.textTracks].filter((t) => ['subtitles', 'captions'].includes(t.kind))
        .length,
    }));
}
