import { copyFile, cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve('kuromoji/package.json'));
const target = path.resolve('public/furigana/v1');
await mkdir(target, { recursive: true });
await copyFile(path.join(source, 'build/kuromoji.js'), path.join(target, 'kuromoji.js'));
await cp(path.join(source, 'dict'), path.join(target, 'dict'), { recursive: true });
for (const file of ['LICENSE-2.0.txt', 'NOTICE.md'])
  await copyFile(path.join(source, file), path.join(target, file));
await build({
  entryPoints: ['src/lib/furigana-worker.ts'],
  outfile: path.join(target, 'worker.js'),
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2022',
});
// Lazy browser-only media processing shares the existing asset preparation hook.
// No codec runtime is imported by the application server or deployed Worker.
await build({
  entryPoints: {
    'media-audio-worker': 'src/lib/media-audio/worker.ts',
    'audio-diagnostics-worker': 'src/lib/audio-diagnostics-worker.ts',
  },
  outdir: target,
  entryNames: '[name]',
  bundle: true,
  minify: true,
  platform: 'browser',
  target: 'es2022',
});
const mediaSource = path.resolve(path.dirname(require.resolve('mediabunny')), '../..');
await copyFile(path.join(mediaSource, 'LICENSE'), path.join(target, 'MEDIABUNNY-LICENSE.txt'));
const mediaWorker = await readFile(path.join(target, 'media-audio-worker.js'));
console.log(
  `Optional audio worker: ${mediaWorker.length} bytes / ${gzipSync(mediaWorker).length} gzip; loaded on request.`,
);
const dictionaryBytes = (
  await Promise.all(
    (await readdir(path.join(target, 'dict'))).map(
      async (file) => (await stat(path.join(target, 'dict', file))).size,
    ),
  )
).reduce((a, b) => a + b, 0);
const parser = await readFile(path.join(target, 'kuromoji.js'));
console.log(
  `Furigana optional assets: dictionary ${dictionaryBytes} bytes (already gzip), browser parser ${parser.length} bytes / ${gzipSync(parser).length} gzip bytes. Never loaded while disabled.`,
);
