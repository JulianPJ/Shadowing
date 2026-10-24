// These run in the page's own JavaScript world (chrome.scripting `world: 'MAIN'`), where a custom
// player's API is visible. Chrome serialises each function into the page: no outside names. What
// they return comes from the page, so the service worker treats it as untrusted.

/**
 * Players such as Vidstack fetch a subtitle file only once its track is turned on, so the video's
 * own <track> elements carry no cues for the others. This turns the Japanese (or unlabelled)
 * tracks on as hidden, so the page's visible subtitles do not change, reads their cues and
 * restores each mode.
 */
export async function loadPlayerTracks(videoIndex) {
  const video = [...document.querySelectorAll('video')]
    .filter((v) => v.isConnected)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[videoIndex];
  // Vidstack's <media-player> keeps its own text track list.
  const list = video?.closest('media-player')?.textTracks;
  if (!list || typeof list[Symbol.iterator] !== 'function') return [];
  const tracks = [];
  for (const track of [...list].slice(0, 20)) {
    const label = typeof track.label === 'string' ? track.label : '';
    const language = typeof track.language === 'string' ? track.language : '';
    if (!['subtitles', 'captions'].includes(track.kind)) continue;
    if (language && !/^ja(-|$)/i.test(language) && !/日本語|japanese/i.test(label)) continue;
    const mode = track.mode;
    if (mode === 'disabled') track.mode = 'hidden';
    for (let waited = 0; !track.cues?.length && waited < 4000; waited += 100)
      await new Promise((resolve) => setTimeout(resolve, 100));
    const cues = [...(track.cues ?? [])]
      .slice(0, 15000)
      .map((cue) => ({ start: cue.startTime, end: cue.endTime, text: String(cue.text ?? '') }));
    track.mode = mode;
    if (cues.length) tracks.push({ label, language, cues });
  }
  return tracks;
}

/** The address a custom player loaded into the video (for Vidstack, its HLS playlist). */
export function playerSource(videoIndex) {
  const video = [...document.querySelectorAll('video')]
    .filter((v) => v.isConnected)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[videoIndex];
  const source = video?.closest('media-player')?.state?.source;
  if (!source || typeof source.src !== 'string') return null;
  return { src: source.src, type: typeof source.type === 'string' ? source.type : '' };
}
