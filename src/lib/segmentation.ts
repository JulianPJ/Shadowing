import type { Cue, Segment } from './types';

export function cleanText(text: string) {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/\s+/g, ' ')
    .trim();
}
export function validateCues(input: unknown): Cue[] {
  if (!Array.isArray(input) || input.length === 0)
    throw new Error(
      'No timestamped speech was found. Import Japanese SRT, VTT, ASS, SSA, or JSON. Plain text needs timestamps.',
    );
  if (input.length > 15000)
    throw new Error(
      'This transcript is too large. Please use a shorter video (up to 15,000 caption cues).',
    );
  const cues: Cue[] = [];
  for (const value of input) {
    if (!value || typeof value !== 'object')
      throw new Error('Each transcript section needs start, end, and text.');
    const row = value as Record<string, unknown>;
    const start = row.start ?? row.offset;
    const end =
      row.end ??
      (typeof row.duration === 'number' && typeof start === 'number'
        ? start + row.duration
        : undefined);
    const text = row.text ?? row.japanese;
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end <= start ||
      end > 86400 ||
      typeof text !== 'string' ||
      text.length > 10000
    )
      throw new Error(
        'Transcript timings must be numbers in seconds, with end later than start (maximum 24 hours).',
      );
    const cleaned = cleanText(text);
    if (!cleaned || /^\s*[\[【（(].*(music|音楽|拍手).*$/i.test(cleaned)) continue;
    cues.push({
      start,
      end,
      text: cleaned,
      translation: typeof row.translation === 'string' ? row.translation.slice(0, 2000) : undefined,
      estimated: row.estimated === true,
    });
  }
  if (!cues.length) throw new Error('The transcript contains no spoken text.');
  return cues.sort((a, b) => a.start - b.start);
}

/** Use caption, punctuation, clause, and silence boundaries. Never invent equal-duration cuts.
 * A long cue is split only at linguistic boundaries; its sub-timings are explicitly estimated.
 */
export function segmentTranscript(input: Cue[]): Segment[] {
  const normalized: Cue[] = [];
  for (const original of validateCues(input)) {
    const cue = { ...original };
    const previous = normalized.at(-1);
    if (previous && cue.start < previous.end && cue.text === previous.text) {
      previous.end = Math.max(previous.end, cue.end);
      continue;
    }
    // Remove repeated prefix from overlapping rolling auto-captions.
    if (previous && cue.start < previous.end && cue.text.startsWith(previous.text)) {
      cue.text = cue.text.slice(previous.text.length).trim();
      cue.start = Math.min(previous.end, cue.end - 0.05);
      cue.estimated = true;
      if (!cue.text) continue;
    }
    normalized.push(cue);
  }
  // Auto-captions often have overlapping display durations. The next cue's start
  // is the useful speech boundary, rather than its predecessor's display timeout.
  for (let i = 0; i < normalized.length - 1; i++) {
    if (normalized[i + 1].start > normalized[i].start)
      normalized[i].end = Math.min(normalized[i].end, normalized[i + 1].start);
  }
  const pieces: Cue[] = [];
  for (const cue of normalized) {
    const length = cue.end - cue.start;
    if (cue.translation) {
      pieces.push(cue);
      continue;
    }
    const sentences = cue.text.match(/[^。！？!?]+[。！？!?]?/g) ?? [cue.text];
    if (length <= 8.5 && sentences.length === 1) {
      pieces.push(cue);
      continue;
    }
    const parts = sentences
      .flatMap((s) => (length > 8.5 && s.length > 42 ? (s.match(/[^、,]+[、,]?/g) ?? [s]) : [s]))
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      pieces.push(cue);
      continue;
    }
    const characters = parts.reduce((n, text) => n + text.length, 0);
    let start = cue.start;
    for (const text of parts) {
      const end = start + (length * text.length) / characters;
      pieces.push({ start, end, text, estimated: true });
      start = end;
    }
  }
  const groups: Cue[] = [];
  for (const cue of pieces) {
    const previous = groups.at(-1);
    const gap = previous ? cue.start - previous.end : Infinity;
    const duration = previous ? previous.end - previous.start : 0;
    const sentenceEnd = previous && /[。！？!?]$/.test(previous.text);
    const needsCompletion =
      !sentenceEnd || (duration < 1.1 && previous && previous.text.length <= 5);
    const finishesSentence = /[。！？!?]$/.test(cue.text);
    const fits =
      previous &&
      (cue.end - previous.start <= 8.5 ||
        (needsCompletion && finishesSentence && cue.end - previous.start <= 11));
    if (
      previous &&
      !previous.translation &&
      !cue.translation &&
      gap >= -0.2 &&
      gap < 0.65 &&
      fits &&
      needsCompletion
    ) {
      previous.text += /[a-zA-Z]$/.test(previous.text) ? ` ${cue.text}` : cue.text;
      previous.end = cue.end;
      previous.estimated ||= cue.estimated;
    } else groups.push({ ...cue });
  }
  return groups
    .map((cue, index) => ({
      id: `segment-${index + 1}`,
      start: cue.start,
      end: Math.min(cue.end, groups[index + 1]?.start ?? cue.end),
      japanese: cue.text,
      translation: cue.translation,
      estimated: cue.estimated,
    }))
    .filter((s) => s.end > s.start);
}
