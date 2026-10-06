// Full English JMdict, not a small demo vocabulary. Derived data is CC BY-SA 4.0.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import path from 'node:path';

const sourceFile = path.resolve('scripts/lexicon-source.json');
let source = JSON.parse(await readFile(sourceFile, 'utf8'));
if (process.argv.includes('--update')) {
  const response = await fetch(
    'https://api.github.com/repos/scriptin/jmdict-simplified/releases/latest',
  );
  if (!response.ok) throw new Error('JMdict release discovery failed');
  const release = await response.json();
  const asset = release.assets.find(
    (item) => /^jmdict-eng-[^/]+\.json\.tgz$/.test(item.name) && !item.name.includes('common'),
  );
  if (!asset?.digest?.startsWith('sha256:'))
    throw new Error('JMdict release has no SHA-256 digest');
  source = {
    version: release.tag_name,
    url: asset.browser_download_url,
    sha256: asset.digest.slice(7),
  };
  await writeFile(sourceFile, JSON.stringify(source, null, 2) + '\n');
}
const target = path.resolve('public/lexicon', source.version);
try {
  const manifest = JSON.parse(await readFile(path.join(target, 'manifest.json'), 'utf8'));
  if (manifest.sourceSha256 === source.sha256) {
    console.log(
      `JMdict ${source.version}: ${manifest.entryCount} entries; assets already prepared.`,
    );
    process.exit(0);
  }
} catch {
  /* The first build downloads a pinned, verified source. */
}
await mkdir('.lexicon-cache', { recursive: true });
let archive;
try {
  archive = await readFile('.lexicon-cache/source.tgz');
} catch {
  /* Download below. */
}
const checksum = (buffer) => createHash('sha256').update(buffer).digest('hex');
if (!archive || checksum(archive) !== source.sha256) {
  const response = await fetch(source.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error('Pinned JMdict download failed');
  archive = Buffer.from(await response.arrayBuffer());
  if (checksum(archive) !== source.sha256) throw new Error('JMdict source checksum mismatch');
  await writeFile('.lexicon-cache/source.tgz', archive);
}
const tar = gunzipSync(archive);
let dictionary;
for (let offset = 0; offset + 512 <= tar.length;) {
  const name = tar
    .subarray(offset, offset + 100)
    .toString()
    .replace(/\0.*$/s, '');
  const size = parseInt(tar.subarray(offset + 124, offset + 136).toString(), 8) || 0;
  if (name.endsWith('.json')) {
    dictionary = JSON.parse(tar.subarray(offset + 512, offset + 512 + size).toString());
    break;
  }
  offset += 512 + Math.ceil(size / 512) * 512;
}
if (!dictionary || dictionary.commonOnly || dictionary.words.length < 200000)
  throw new Error('Incomplete JMdict source');
// Keep this hash identical to src/lib/lexicon/shard.ts.
function shard(value) {
  let hash = 2166136261;
  for (const char of value) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return (hash >>> 0) % 256;
}
const index = Array.from({ length: 256 }, () => ({}));
const entries = Array.from({ length: 256 }, () => ({}));
for (const word of dictionary.words) {
  // Preserve reading/orthography/sense restrictions, POS, register and commonness markers.
  const entry = {
    id: word.id,
    kanji: word.kanji,
    kana: word.kana,
    sense: word.sense.map((sense) => ({
      partOfSpeech: sense.partOfSpeech,
      appliesToKanji: sense.appliesToKanji,
      appliesToKana: sense.appliesToKana,
      field: sense.field,
      dialect: sense.dialect,
      misc: sense.misc,
      info: sense.info,
      gloss: sense.gloss.filter((gloss) => gloss.lang === 'eng').map((gloss) => gloss.text),
    })),
  };
  entries[shard(word.id)][word.id] = entry;
  for (const term of new Set(
    [...word.kanji, ...word.kana].map((item) => item.text.normalize('NFC')),
  )) {
    const bucket = index[shard(term)];
    (bucket[term] ??= []).push(word.id);
  }
}
await mkdir(target, { recursive: true });
let bytes = 0,
  largestShardBytes = 0;
for (let i = 0; i < 256; i++) {
  for (const [kind, data] of [
    ['index', index[i]],
    ['entries', entries[i]],
  ]) {
    const serialized = JSON.stringify(data);
    const size = Buffer.byteLength(serialized);
    bytes += size;
    largestShardBytes = Math.max(largestShardBytes, size);
    await writeFile(path.join(target, `${kind}-${i}.json`), serialized);
  }
}
const manifest = {
  schemaVersion: 1,
  version: source.version,
  dictionaryDate: dictionary.dictDate,
  sourceUrl: source.url,
  sourceSha256: source.sha256,
  entryCount: dictionary.words.length,
  bytes,
  largestShardBytes,
  shardCount: 256,
  tags: dictionary.tags,
  attribution:
    'JMdict © James William Breen and the Electronic Dictionary Research and Development Group. JSON conversion by scriptin; Hibiki compacts and shards the English data.',
  license: 'CC BY-SA 4.0',
  licenseUrl: 'https://www.edrdg.org/edrdg/licence.html',
};
await writeFile(path.join(target, 'manifest.json'), JSON.stringify(manifest));
await writeFile(
  path.resolve('public/lexicon/NOTICE.txt'),
  `${manifest.attribution}\nDerived dictionary data: Creative Commons Attribution-ShareAlike 4.0.\nhttps://creativecommons.org/licenses/by-sa/4.0/\n${manifest.licenseUrl}\nSource: ${source.url}\nNo warranty. Hibiki is not endorsed by EDRDG.\n`,
);
console.log(
  `JMdict ${source.version}: ${manifest.entryCount} full English entries, ${bytes} bytes in 512 lazy shards, largest ${largestShardBytes} bytes. Not in the JS/Worker bundle.`,
);
