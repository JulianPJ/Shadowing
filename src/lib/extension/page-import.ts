import { createImportedLesson } from '../import-lesson';
import { pageMedia, remoteUrl } from '../media';
import { validateCues } from '../segmentation';
import type { BridgeTrack, PendingPageImport } from './bridge';

const MAX_PAGE_SECONDS = 4 * 3600;

/** Checks the video description Hibiki Bridge hands over before any of it reaches a lesson. */
export function validatePendingImport(value: unknown): PendingPageImport {
  const unreadable = new Error(
    'Hibiki Bridge did not send a video. Open the extension on a page with a video and try again.',
  );
  if (!value || typeof value !== 'object') throw unreadable;
  const v = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(v.tabId) ||
    typeof v.pageUrl !== 'string' ||
    typeof v.duration !== 'number' ||
    !Number.isFinite(v.duration) ||
    v.duration <= 0 ||
    !Array.isArray(v.tracks)
  )
    throw unreadable;
  if (v.duration > MAX_PAGE_SECONDS)
    throw new Error('Hibiki supports page videos up to four hours long.');
  remoteUrl(v.pageUrl);
  const tracks = v.tracks.slice(0, 20).flatMap((track): BridgeTrack[] => {
    if (!track || typeof track !== 'object') return [];
    const t = track as Record<string, unknown>;
    try {
      return [
        {
          label: typeof t.label === 'string' ? t.label.slice(0, 120) : '',
          language: typeof t.language === 'string' ? t.language.slice(0, 35) : '',
          cues: validateCues(t.cues),
        },
      ];
    } catch {
      return [];
    }
  });
  return {
    tabId: v.tabId as number,
    pageUrl: v.pageUrl,
    title: typeof v.title === 'string' ? v.title.trim().slice(0, 300) : '',
    duration: v.duration,
    tracks,
  };
}

const JAPANESE = /[\u3040-\u30ff\u3400-\u9fff]/g;
/** A track labelled Japanese, or an unlabelled one whose text is mostly Japanese. */
export function japaneseTrack(tracks: readonly BridgeTrack[]) {
  return (
    tracks.find(
      (track) => /^ja(-|$)/i.test(track.language) || /日本語|japanese/i.test(track.label),
    ) ??
    tracks.find((track) => {
      if (track.language) return false;
      const text = track.cues.map((cue) => cue.text).join('');
      return text.length > 0 && (text.match(JAPANESE)?.length ?? 0) / text.length > 0.3;
    }) ??
    null
  );
}

/** A lesson from the page's own Japanese subtitles. */
export async function lessonFromPageTrack(pending: PendingPageImport, track: BridgeTrack) {
  return createImportedLesson({
    page: { media: await pageMedia(pending.pageUrl), title: pending.title },
    cues: track.cues,
    transcriptType: 'provider-captions',
    provenance: `Page subtitles · ${track.label || track.language || 'Japanese'}`,
  });
}
