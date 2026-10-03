import { validateCues } from './segmentation';
import type { Cue } from './types';
function time(input: string) {
  const values = input.replace(',', '.').split(':').map(Number);
  return values.reduce((sum, value) => sum * 60 + value, 0);
}
export function parseSubtitles(input: string): Cue[] {
  const text = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
  if (text.startsWith('[') || text.startsWith('{')) {
    let data: unknown;
    try { data = JSON.parse(text); } catch { throw new Error('This JSON file is invalid. Check the transcript format in the README.'); }
    return validateCues(Array.isArray(data) ? data : (data as { segments?: unknown })?.segments);
  }
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex(line => /-->/.test(line));
    if (index < 0 || /^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const match = lines[index].match(/((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})/);
    if (!match) throw new Error('A subtitle timestamp could not be read. Use standard SRT or WebVTT timings.');
    cues.push({ start: time(match[1]), end: time(match[2]), text: lines.slice(index + 1).join(' ') });
  }
  return validateCues(cues);
}
