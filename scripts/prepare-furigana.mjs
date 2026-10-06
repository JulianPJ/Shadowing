import { copyFile, cp, mkdir, readFile, readdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const kuromojiSource = path.dirname(require.resolve('kuromoji/package.json'));
const kuromojiTarget = path.resolve('public/furigana/v1');
const wasmTarget = path.resolve('public/furigana/v2');

await mkdir(kuromojiTarget, { recursive: true });
await mkdir(wasmTarget, { recursive: true });

await copyFile(path.join(kuromojiSource, 'build/kuromoji.js'), path.join(kuromojiTarget, 'kuromoji.js'));
await cp(path.join(kuromojiSource, 'dict'), path.join(kuromojiTarget, 'dict'), { recursive: true });
for (const file of ['LICENSE-2.0.txt', 'NOTICE.md'])
  await copyFile(path.join(kuromojiSource, file), path.join(kuromojiTarget, file));

// Preserve the original URL for cached clients and also ship it as the explicit fallback
// used by the new Rust/WASM client.
for (const outfile of [
  path.join(kuromojiTarget, 'worker.js'),
  path.join(wasmTarget, 'fallback-worker.js'),
]) {
  await build({
    entryPoints: ['src/lib/furigana-kuromoji-worker.ts'],
    outfile,
    bundle: true,
    minify: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
  });
}

const linderaEntry = require.resolve('lindera-wasm-web-ipadic');
const linderaSource = path.dirname(linderaEntry);
const linderaFiles = await readdir(linderaSource);
const linderaWasm = linderaFiles.find((file) => file.endsWith('.wasm'));
if (!linderaWasm) throw new Error('lindera-wasm-web-ipadic did not contain a WebAssembly binary.');

await copyFile(linderaEntry, path.join(wasmTarget, 'lindera_wasm.js'));
await copyFile(path.join(linderaSource, linderaWasm), path.join(wasmTarget, linderaWasm));
for (const license of ['LICENSE', 'LICENSE.txt', 'LICENSE-MIT']) {
  if (!linderaFiles.includes(license)) continue;
  await copyFile(path.join(linderaSource, license), path.join(wasmTarget, 'LINDERA_LICENSE.txt'));
  break;
}

await build({
  entryPoints: ['src/lib/furigana-worker.ts'],
  outfile: path.join(wasmTarget, 'worker.js'),
  bundle: true,
  minify: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
});

const dictionaryBytes = (
  await Promise.all(
    (await readdir(path.join(kuromojiTarget, 'dict'))).map(
      async (file) => (await stat(path.join(kuromojiTarget, 'dict', file))).size,
    ),
  )
).reduce((a, b) => a + b, 0);
const parser = await readFile(path.join(kuromojiTarget, 'kuromoji.js'));
const wasmBytes = (await stat(path.join(wasmTarget, linderaWasm))).size;
console.log(
  [
    `Japanese analysis optional assets: Lindera Rust/WASM ${wasmBytes} bytes (preferred)`,
    `Kuromoji fallback dictionary ${dictionaryBytes} bytes (already gzip)`,
    `fallback parser ${parser.length} bytes / ${gzipSync(parser).length} gzip bytes`,
    'nothing is loaded until Japanese analysis is requested.',
  ].join('; '),
);
