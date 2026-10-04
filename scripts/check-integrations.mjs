import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const videos = process.argv.slice(3).length ? process.argv.slice(3) : ['IJ6R4u05ppw', 'KJblreFQ2R8'];
const report = { base, checkedAt: new Date().toISOString(), captions: [], translation: null };
let failed = false;
for (const input of videos) {
  const url = input.startsWith('http') ? input : `https://www.youtube.com/watch?v=${input}`;
  const started = Date.now();
  const events = [];
  try {
    const response = await fetch(`${base}/api/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }), signal: AbortSignal.timeout(35000) });
    console.log('Prepare:', url, 'HTTP', response.status, response.headers.get('content-type'));
    const decoder = new TextDecoder();
    let buffer = '';
    function readLine(line) {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      events.push({ elapsedMs: Date.now() - started, ...event });
      console.log(`${Date.now() - started}ms`, event.lesson ? { stage: event.stage, title: event.lesson.title, sections: event.lesson.segments.length, provider: event.lesson.transcriptSource } : event);
    }
    for await (const chunk of response.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n'); buffer = lines.pop() ?? '';
      lines.forEach(readLine);
    }
    readLine(buffer + decoder.decode());
    const lesson = events.find(event => event.lesson)?.lesson;
    assert.equal(response.status, 200);
    assert.ok(lesson?.segments?.length, 'Preparation did not return a lesson');
    assert.ok(lesson.segments.every(segment => Number.isFinite(segment.start) && segment.end > segment.start && segment.japanese.trim()), 'Invalid lesson sections');
    report.captions.push({ url, status: response.status, elapsedMs: Date.now() - started, events });
  } catch (error) {
    failed = true;
    console.error('Caption check failed:', error.message);
    report.captions.push({ url, elapsedMs: Date.now() - started, events, error: error.message });
  }
}
try {
  const started = Date.now();
  const response = await fetch(`${base}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      japanese: 'ゆゆの日本語ポッドキャストのお時間です。',
      previousJapanese: 'みなさんこんにちは。',
      nextJapanese: '今日のテーマについて話します。',
    }),
    signal: AbortSignal.timeout(18000),
  });
  const result = await response.json();
  report.translation = { status: response.status, elapsedMs: Date.now() - started, ...result };
  console.log('Translation:', report.translation);
  if (!response.ok || !result.translation || !/podcast/i.test(result.translation)) failed = true;
} catch (error) { failed = true; report.translation = { error: error.message }; }
await mkdir('artifacts', { recursive: true });
const target = `artifacts/integration-${new URL(base).hostname}-${Date.now()}.json`;
await writeFile(target, JSON.stringify(report, null, 2));
console.log('Report:', target);
if (failed) process.exitCode = 1;
