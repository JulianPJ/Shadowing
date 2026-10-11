import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canonicalYouTubeUrl } from '../extension/youtube.js';

const id = 'dQw4w9WgXcQ';
const canonical = 'https://www.youtube.com/watch?v=' + id;

test('all links for one YouTube video have the same canonical identity', () => {
  for (const input of [
    'https://www.youtube.com/watch?v=' + id,
    'https://www.youtube.com/watch?v=' + id + '&list=LL&index=3&t=10s',
    'https://m.youtube.com/watch?feature=share&v=' + id,
    'https://music.youtube.com/watch?v=' + id,
    'https://youtu.be/' + id + '?si=anything',
    'https://www.youtube.com/shorts/' + id,
    'https://www.youtube.com/live/' + id + '?feature=share',
    'https://www.youtube-nocookie.com/embed/' + id,
  ]) {
    assert.equal(canonicalYouTubeUrl(input), canonical, input);
  }
});

test('reject unrelated pages, invalid IDs and lookalike domains', () => {
  for (const input of [
    '',
    'not a url',
    'javascript:alert(1)',
    'https://www.youtube.com/',
    'https://www.youtube.com/results?search_query=japanese',
    'https://www.youtube.com/watch?v=short',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ123',
    'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
    'https://fake-youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ/another',
  ]) {
    assert.equal(canonicalYouTubeUrl(input), null, input);
  }
});

