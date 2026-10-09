import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  RESUME_SLACK_SECONDS,
  continuingIntoSection,
  createSectionLookup,
} from '../src/lib/section-lookup';
import type { Segment } from '../src/lib/types';

const segment = (id: string, start: number, end: number): Segment => ({
  id,
  start,
  end,
  japanese: id,
});
// Touching sections like the YouTube lesson where Continue first bounced back: 3:06–3:17, 3:17–3:24.
const touching = [segment('a', 186, 197), segment('b', 197, 204), segment('c', 210, 215)];
const lookup = createSectionLookup(touching, 215);
const keeps = (index: number, time: number) =>
  continuingIntoSection(touching, index, lookup(time), time);

test('Continue into a touching section survives the 20 ms lead-in window', () => {
  // The player pauses at end - 0.025; the next tick can land inside the lookup's lead-in.
  for (const time of [196.975, 196.985, 196.999]) {
    assert.equal(lookup(time), 0, `lookup still returns the previous row at ${time}`);
    assert.equal(keeps(1, time), true, `keeps the armed section at ${time}`);
  }
  assert.equal(lookup(197), 1);
});

test('a provider reporting a resumed time slightly early keeps the armed section', () => {
  assert.equal(keeps(1, 196.8), true);
  assert.equal(keeps(1, 197 - RESUME_SLACK_SECONDS), true);
});

test('gaps before the next speech keep the armed section; genuine seeks back do not', () => {
  assert.equal(keeps(2, 204), true, 'start of the gap after b');
  assert.equal(keeps(2, 208), true, 'middle of the gap');
  assert.equal(keeps(1, 190), false, 'seeking well back into the previous section re-selects it');
  assert.equal(keeps(2, 199), false, 'not the section immediately before');
  assert.equal(keeps(0, 186), false, 'the first section has nothing before it');
});
