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
