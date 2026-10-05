// Run only to rebuild the bundled sample. End users need no TTS service or API key.
import { EdgeTTS } from '@andresaya/edge-tts';
import ffmpeg from 'ffmpeg-static';
import sharp from 'sharp';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const dir = path.resolve('.demo-build');
await mkdir(dir, { recursive: true });
await mkdir('src/data', { recursive: true });
const lines = JSON.parse(await readFile('scripts/demo-lines.json', 'utf8'));
function run(args) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr);
}
let position = 0;
const segments = [];
for (let i = 0; i < lines.length; i++) {
  const mp3 = path.join(dir, `${i}.mp3`);
  const wav = path.join(dir, `${i}.wav`);
  const tts = new EdgeTTS();
  await tts.synthesize(lines[i].japanese, 'ja-JP-NanamiNeural', { rate: '-12%' });
  await writeFile(mp3, tts.toBuffer());
  run(['-i', mp3, '-af', 'apad=pad_dur=0.5', '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', wav]);
  const bytes = await readFile(wav);
  // Decode RIFF chunks to get actual PCM sample duration (not an estimated TTS length).
  let dataSize = 0;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const size = bytes.readUInt32LE(offset + 4);
    if (bytes.toString('ascii', offset, offset + 4) === 'data') {
      dataSize = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  const duration = dataSize / (24000 * 2);
  segments.push({
    id: `segment-${i + 1}`,
    start: Number(position.toFixed(3)),
    end: Number((position + duration - 0.25).toFixed(3)),
    ...lines[i],
  });
  position += duration;
  console.log(`Prepared section ${i + 1}/${lines.length}: ${duration.toFixed(2)}s`);
}
await writeFile(path.join(dir, 'concat.txt'), lines.map((_, i) => `file '${i}.wav'`).join('\n'));
run([
  '-f',
  'concat',
  '-safe',
  '0',
  '-i',
  path.join(dir, 'concat.txt'),
  '-c:a',
  'pcm_s16le',
  path.join(dir, 'speech.wav'),
]);
await sharp('public/demo-poster.svg').png().toFile(path.join(dir, 'poster.png'));
run([
  '-loop',
  '1',
  '-i',
  path.join(dir, 'poster.png'),
  '-i',
  path.join(dir, 'speech.wav'),
  '-c:v',
  'libx264',
  '-preset',
  'fast',
  '-tune',
  'stillimage',
  '-r',
  '12',
  '-pix_fmt',
  'yuv420p',
  '-c:a',
  'aac',
  '-b:a',
  '96k',
  '-shortest',
  '-movflags',
  '+faststart',
  'public/demo.mp4',
]);
await writeFile(
  'src/data/demo.json',
  JSON.stringify(
    {
      id: 'demo',
      title: 'A quiet morning',
      author: 'Hibiki Listening Studio',
      source: 'demo',
      mediaUrl: '/demo.mp4',
      transcriptSource: 'Original studio script · Japanese synthetic voice',
      segments,
    },
    null,
    2,
  ) + '\n',
);
const stamp = (n) => new Date(n * 1000).toISOString().slice(11, 23);
await writeFile(
  'public/demo.vtt',
  'WEBVTT\n\n' +
    segments.map((s) => `${stamp(s.start)} --> ${stamp(s.end)}\n${s.japanese}`).join('\n\n'),
);
console.log(`Bundled ${position.toFixed(1)} seconds of Japanese speech.`);
