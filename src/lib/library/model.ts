import { remoteUrl } from '../media';
import { parseYouTubeUrl } from '../youtube';

export const LIBRARY_LIMIT = 60;
export const QUEUE_LIMIT = 40;
export type QueueItem = { id: string; url: string; title: string; addedAt: string };
export type LibraryState = { version: 1; pinned: string[]; queue: QueueItem[] };
export const emptyLibrary = (): LibraryState => ({ version: 1, pinned: [], queue: [] });

export function normalizeQueueUrl(input: string) {
  const url = remoteUrl(input);
  try {
    return `https://www.youtube.com/watch?v=${parseYouTubeUrl(url.href)}`;
  } catch {
    /* Other supported media keep their existing URL. */
  }
  return url.href;
}

export function validateLibrary(value: unknown): LibraryState {
  if (!value || typeof value !== 'object') return emptyLibrary();
  const raw = value as Partial<LibraryState>;
  if (raw.version !== 1) return emptyLibrary();
  const pinned = Array.isArray(raw.pinned)
    ? [
        ...new Set(
          raw.pinned.filter((id) => typeof id === 'string' && id.trim() && id.length <= 200),
        ),
      ].slice(0, LIBRARY_LIMIT)
    : [];
  const queue: QueueItem[] = [];
  if (Array.isArray(raw.queue))
    for (const item of raw.queue.slice(0, QUEUE_LIMIT)) {
      try {
        if (
          !item ||
          typeof item.id !== 'string' ||
          item.id.length > 100 ||
          typeof item.title !== 'string' ||
          !Number.isFinite(Date.parse(item.addedAt))
        )
          continue;
        const url = normalizeQueueUrl(item.url);
        if (queue.some((old) => old.url === url)) continue;
        queue.push({ id: item.id, url, title: item.title.slice(0, 160), addedAt: item.addedAt });
      } catch {
        /* Invalid stored URLs never become navigation links. */
      }
    }
  return { version: 1, pinned, queue };
}

export function enqueue(state: LibraryState, input: QueueItem): LibraryState {
  const url = normalizeQueueUrl(input.url);
  if (state.queue.some((item) => item.url === url))
    throw new Error('This link is already in your queue.');
  if (state.queue.length >= QUEUE_LIMIT)
    throw new Error('Your queue has 40 links. Remove one before adding another.');
  return validateLibrary({ ...state, queue: [...state.queue, { ...input, url }] });
}

export type CoverageEvidence = {
  knownPercent: number | null;
  uniqueLemmas: number;
  trackedLemmas: number;
};
export type ContentFit = {
  label: 'Comfortable' | 'Stretch' | 'Hard' | 'Not enough evidence';
  reason: string;
  knownPercent: number | null;
  rank: number;
};
/** Heuristic vocabulary fit, not listening ability. Missing learner knowledge always abstains. */
export function contentFit(
  coverage: CoverageEvidence | null,
  difficultyLabel?: string,
  aboveTypical = false,
): ContentFit {
  const level = difficultyLabel ? ` Content estimate: ${difficultyLabel}.` : '';
  if (
    !coverage ||
    coverage.knownPercent === null ||
    !Number.isFinite(coverage.knownPercent) ||
    !Number.isSafeInteger(coverage.uniqueLemmas) ||
    !Number.isSafeInteger(coverage.trackedLemmas) ||
    coverage.uniqueLemmas < 10 ||
    coverage.trackedLemmas < 5
  )
    return {
      label: 'Not enough evidence',
      reason: `Mark at least five words in a transcript with ten distinct content words to estimate fit.${level}`,
      knownPercent: null,
      rank: 3,
    };
  const knownPercent = Math.max(0, Math.min(100, Math.round(coverage.knownPercent)));
  const base = knownPercent >= 90 ? 'Comfortable' : knownPercent >= 75 ? 'Stretch' : 'Hard';
  const label = aboveTypical && base === 'Comfortable' ? 'Stretch' : base;
  return {
    label,
    knownPercent,
    rank: { Comfortable: 0, Stretch: 1, Hard: 2 }[label],
    reason: `${knownPercent}% of the content-word occurrences are explicitly marked Known; unmarked and Learning words count as unfamiliar.${level}${aboveTypical ? ' This content is above your recent practised content range.' : ''} This is vocabulary fit, not a comprehension score.`,
  };
}
