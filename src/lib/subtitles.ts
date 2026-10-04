import { validateCues } from './segmentation';
import type { Cue } from './types';
function time(input: string) {
  const values = input.replace(',', '.').split(':').map(Number);
  return values.reduce((sum, value) => sum * 60 + value, 0);
}
function assTime(input: string, line: number) {
  const match = input.trim().match(/^(\d{1,2}):([0-5]\d):([0-5]\d)\.(\d{2})$/);
  if (!match) throw new Error(`ASS/SSA timestamp on line ${line} is invalid. Use h:mm:ss.cc.`);
  return (
    Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(match[4]) / 100
  );
}
function assText(input: string) {
  let drawing = false;
  return input
    .split(/(\{[^}]*\})/)
    .map((part) => {
      if (part.startsWith('{')) {
        const modes = [...part.matchAll(/\\p(\d+)/g)];
        if (modes.length) drawing = Number(modes.at(-1)![1]) > 0;
        return '';
      }
      return drawing ? '' : part;
    })
    .join('')
    .replace(/\\[Nn]/g, ' ')
    .replace(/\\h/g, ' ');
}
export function parseAss(input: string): Cue[] {
  let events = false;
  let foundEvents = false;
  let format: string[] | undefined;
  const cues: Cue[] = [];
  for (const [index, raw] of input.split('\n').entries()) {
    const line = raw.trim();
    if (/^\[.+\]$/.test(line)) {
      events = /^\[Events\]$/i.test(line);
      foundEvents ||= events;
      format = undefined;
      continue;
    }
    if (!events || !line || line.startsWith(';')) continue;
    if (/^Format\s*:/i.test(line)) {
      format = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((field) => field.trim().toLowerCase());
      if (
        !format.includes('start') ||
        !format.includes('end') ||
        format.at(-1) !== 'text' ||
        new Set(format).size !== format.length
      )
        throw new Error('ASS/SSA Events Format needs Start, End, and a final Text column.');
    } else if (/^Dialogue\s*:/i.test(line)) {
      // Standard ASS and SSA share these positions; SSA uses Marked in place of Layer.
      const fields = format || [
        'layer',
        'start',
        'end',
        'style',
        'name',
        'marginl',
        'marginr',
        'marginv',
        'effect',
        'text',
      ];
      const parts = line.slice(line.indexOf(':') + 1).split(',');
      if (parts.length < fields.length)
        throw new Error(`ASS/SSA Dialogue on line ${index + 1} has missing fields.`);
      const text = parts.slice(fields.length - 1).join(',');
      if (/[{}]/.test(text.replace(/\{[^{}]*\}/g, '')))
        throw new Error(`ASS/SSA override tag on line ${index + 1} is incomplete or nested.`);
      cues.push({
        start: assTime(parts[fields.indexOf('start')], index + 1),
        end: assTime(parts[fields.indexOf('end')], index + 1),
        text: assText(text),
      });
    }
  }
  if (!foundEvents || !cues.length)
    throw new Error('ASS/SSA needs an [Events] section with timestamped Dialogue lines.');
  return validateCues(cues);
}
export function parseSubtitles(input: string): Cue[] {
  const text = input
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .trim();
  if (/^\[(?:Script Info|Events|V4\+? Styles)\]/im.test(text)) return parseAss(text);
  if (text.startsWith('[') || text.startsWith('{')) {
    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error('This JSON file is invalid. Check the transcript format in the README.');
    }
    return validateCues(Array.isArray(data) ? data : (data as { segments?: unknown })?.segments);
  }
  const cues: Cue[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split('\n');
    const index = lines.findIndex((line) => /-->/.test(line));
    if (index < 0 || /^(NOTE|STYLE|REGION)(\s|$)/.test(lines[0])) continue;
    const match = lines[index].match(
      /((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})\s*-->\s*((?:\d{1,2}:)?\d{2}:\d{2}[.,]\d{3})/,
    );
    if (!match)
      throw new Error(
        'A subtitle timestamp could not be read. Use standard SRT or WebVTT timings.',
      );
    cues.push({
      start: time(match[1]),
      end: time(match[2]),
      text: lines.slice(index + 1).join(' '),
    });
  }
  return validateCues(cues);
}
