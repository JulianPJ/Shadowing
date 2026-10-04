// Deterministic integration check of the actual production bundle in local workerd.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { Miniflare, convertV4MiniflareOptions, Response } from 'miniflare';

const root = path.resolve('.cloudflare/output/v0/workers/default/bundle');
let captions = 0;
const cues = Array.from({ length: 6 }, (_, i) => ({ start: i * 8, end: i * 8 + 7, text: `今日は日本語の勉強について詳しく話します。毎日練習すると少しずつ上手になります。${i}。` }));
const options = convertV4MiniflareOptions({ workers: [
  {
    name: 'shadowing', modules: true, scriptPath: path.join(root, 'index.js'), modulesRoot: root,
    compatibilityDate: '2026-10-03', compatibilityFlags: ['nodejs_compat', 'global_fetch_strictly_public'],
    d1Databases: { HIBIKI_DB: 'runtime-test' }, serviceBindings: { AI: 'ai-mock' },
    bindings: { YOUTUBE_CAPTION_RELAY_URL: 'https://relay.example', YOUTUBE_CAPTION_RELAY_TOKEN: 'mock-test-token' },
    outboundService: async request => {
      const url = new URL(request.url);
      if (url.hostname === 'www.youtube.com' && url.pathname === '/oembed') return Response.json({ title: 'Runtime fixture', author_name: 'Mock provider' });
      if (url.hostname === 'relay.example' && url.pathname === '/captions') { captions++; if (captions > 1) throw new Error('Caption acquisition must be bypassed'); return Response.json({ videoId: 'IJ6R4u05ppw', language: 'ja', cues, provider: 'mock-captions' }); }
      throw new Error('Unmocked network access');
    },
  },
  {
    name: 'ai-mock', modules: true, compatibilityDate: '2026-10-03',
    script: `import { WorkerEntrypoint } from 'cloudflare:workers';
      let calls = {quiz:0,difficulty:0};
      export default class extends WorkerEntrypoint {
        async fetch() { return Response.json(calls); }
        async run(model,input) {
          if (model.includes('qwen')) {
            if (++calls.quiz > 1) throw new Error('Quiz inference must be bypassed');
            const content=input.messages.find(m=>m.role==='user').content;
            const segments=JSON.parse(content.slice(content.indexOf('{'),content.lastIndexOf('}')+1)).segments;
            return {response:{questions:segments.slice(0,3).map((s,i)=>({kind:'detail',question:'何について話しますか'+i+'？',options:['日本語','英語','数学','料理'],correctIndex:0,explanation:'The speaker discusses Japanese practice.',evidence:{segmentIds:[s.id]}}))}};
          }
          if (++calls.difficulty > 1) throw new Error('Difficulty inference must be bypassed');
          return {answers:Object.fromEntries(Object.entries({overall:'n4_n3',vocabulary:'intermediate',grammar:'elementary',conversation:'intermediate'}).map(([key,choice])=>[key,{type:'choice',choice,confidence:0.5,probabilities:{[choice]:1}}]))};
        }
      }`,
  },
] });
const modules = {};
for (const file of await readdir(root, { recursive: true, withFileTypes: true })) {
  if (!file.isFile()) continue;
  const absolute = path.join(file.parentPath, file.name);
  const name = path.relative(root, absolute).replaceAll('\\', '/');
  const type = name.endsWith('.js') ? 'esm' : name.endsWith('.json') ? 'json' : 'data';
  modules[name] = { type, contents: await readFile(absolute, type === 'data' ? undefined : 'utf8') };
}
options.workers[0].config.manifest = { mainModule: 'index.js', modulesRoot: root, modules };
const mf = new Miniflare(options);
try {
  const db = await mf.getD1Database('HIBIKI_DB', 'shadowing');
  const migration = await readFile('migrations/0001_shared_content.sql', 'utf8');
  await db.batch(migration.split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
  let lesson;
  for (let i = 0; i < 2; i++) {
    const response = await mf.dispatchFetch('https://example.com/api/prepare', { method: 'POST', body: JSON.stringify({ url: 'https://youtu.be/IJ6R4u05ppw' }) });
    const last = JSON.parse((await response.text()).trim().split('\n').at(-1));
    assert.equal(last.stage, 'done'); lesson = last.lesson;
  }
  assert.equal(captions, 1);
  for (const endpoint of ['quiz', 'difficulty']) {
    let first;
    for (let i = 0; i < 2; i++) {
      const response = await mf.dispatchFetch(`https://example.com/api/${endpoint}`, { method: 'POST', body: JSON.stringify({ lesson, content: { contentKey: lesson.mediaSource.contentKey } }) });
      assert.equal(response.status, 200, `${endpoint} failed: ${await response.clone().text()}`);
      assert.equal(response.headers.get('X-Hibiki-Cache'), i ? 'hit' : 'miss');
      const payload = await response.json();
      if (i) assert.deepEqual(payload, first); else first = payload;
    }
  }
  const ai = await mf.getWorker('ai-mock');
  assert.deepEqual(await (await ai.fetch('https://example.com/counts')).json(), { quiz: 1, difficulty: 1 });
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM linked_transcripts').first()).n, 1);
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM generated_artifacts').first()).n, 2);
  console.log('Built Worker + local D1: prepare, quiz, difficulty each miss/save/hit; caption/AI providers called exactly once.');
} finally { await mf.dispose(); }
