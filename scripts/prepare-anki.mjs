import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
await mkdir('public/anki', { recursive: true });
await copyFile('node_modules/sql.js/dist/sql-wasm.wasm', 'public/anki/sql-wasm.wasm');
await writeFile(
  'public/anki/NOTICE.txt',
  (
    await Promise.all(
      ['@zip.js/zip.js', 'sql.js', 'fzstd'].map(
        async (name) =>
          name + '\n\n' + (await readFile('node_modules/' + name + '/LICENSE', 'utf8')),
      ),
    )
  ).join('\n\n'),
);
await build({
  entryPoints: ['src/lib/anki/worker.ts'],
  outfile: 'public/anki/import-worker.js',
  bundle: true,
  platform: 'browser',
  format: 'iife',
  alias: { 'sql.js': 'sql.js/dist/sql-wasm-browser.js' },
  minify: true,
});
