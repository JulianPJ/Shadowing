// Controlled live smoke: never print transcript, quiz, translation or credentials.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.argv[2];
if (!base?.startsWith('https://')) throw new Error('Provide the production HTTPS origin');
const videoId = process.argv[3] || 'IJ6R4u05ppw';
const report = { base, videoId, checkedAt: new Date().toISOString(), preparation: [], artifacts: [] };
let lesson;
for (let i = 0; i < 2; i++) {
  const started = Date.now();
  const response = await fetch(`${base}/api/prepare`, { method: 'POST', body: JSON.stringify({ url: `https://youtu.be/${videoId}` }), signal: AbortSignal.timeout(40000) });
  assert.equal(response.status, 200);
  const events = (await response.text()).trim().split('\n').map(line => JSON.parse(line));
  lesson = events.find(event => event.lesson)?.lesson;
  assert.ok(lesson?.segments?.length, `Preparation failed: ${events.at(-1)?.code ?? 'no lesson'}`);
  report.preparation.push({ status: response.status, segmentCount: lesson.segments.length, elapsedMs: Date.now() - started });
}
for (const type of ['quiz', 'difficulty']) {
  let first;
  for (let i = 0; i < 2; i++) {
    const started = Date.now();
    const response = await fetch(`${base}/api/${type}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lesson, content: { contentKey: lesson.mediaSource.contentKey } }), signal: AbortSignal.timeout(55000) });
    const payload = await response.json();
    assert.equal(response.status, 200, `${type} failed: ${payload.code ?? response.status}`);
    const artifact = payload.quiz ?? payload.analysis;
    assert.ok(artifact.id && artifact.transcriptKey);
    const cache = response.headers.get('X-Hibiki-Cache');
    if (i) { assert.equal(cache, 'hit'); assert.deepEqual(payload, first); } else { assert.ok(['hit', 'miss'].includes(cache)); first = payload; }
    report.artifacts.push({ type, status: response.status, cache, elapsedMs: Date.now() - started, artifactId: artifact.id, transcriptKey: artifact.transcriptKey });
  }
}
const translation = await fetch(`${base}/api/translate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ japanese: '今日はいい天気ですね。' }), signal: AbortSignal.timeout(18000) });
const translated = await translation.json();
assert.equal(translation.status, 200); assert.equal(translated.provider, 'DeepL'); assert.ok(translated.translation);
report.translation = { status: translation.status, provider: translated.provider };
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/d1-production-smoke.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
