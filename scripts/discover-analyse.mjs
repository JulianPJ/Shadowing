// Manually spend Workers AI neurons on Discover videos that have no level yet.
// Usage: npm run discover:analyse -- <videos>   (default 3)
// Reads DISCOVER_ADMIN_TOKEN and optionally HIBIKI_URL from the environment or the ignored
// .env.discover-admin file. Each request handles up to three videos; this loops until the requested
// number has been attempted, nothing is left, or the server stops the run (relay or AI unavailable).
const PER_REQUEST = 3;
const total = Number(process.argv[2] ?? PER_REQUEST);
const base = process.env.HIBIKI_URL ?? 'https://hibikiapp.net';
const token = process.env.DISCOVER_ADMIN_TOKEN;
if (!token) {
  console.error('Set DISCOVER_ADMIN_TOKEN (for example in .env.discover-admin).');
  process.exit(1);
}
if (!Number.isInteger(total) || total < 1) {
  console.error('Give a positive number of videos, e.g. npm run discover:analyse -- 10');
  process.exit(1);
}

const totals = { attempted: 0, analysed: 0, reused: 0, noCaptions: 0, failed: 0 };
let remaining = total;
while (remaining > 0) {
  const response = await fetch(new URL('/api/admin/discover-analysis', base), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ count: Math.min(PER_REQUEST, remaining) }),
  });
  if (!response.ok) {
    console.error(
      response.status === 404
        ? 'Not found: check the URL and that DISCOVER_ADMIN_TOKEN matches the Worker secret.'
        : `Request failed (${response.status}): ${await response.text()}`,
    );
    process.exit(1);
  }
  const result = await response.json();
  for (const r of result.results)
    console.log(`${r.outcome.padEnd(11)} ${r.band ?? '-'}\t${r.videoId}  ${r.title}`);
  for (const key of Object.keys(totals)) totals[key] += result[key];
  remaining -= result.attempted;
  if (result.stopped) {
    console.log(`Stopped: ${result.stopped}`);
    break;
  }
  if (result.attempted === 0) {
    console.log('No more videos need an estimate.');
    break;
  }
}
console.log(
  `Attempted ${totals.attempted}: ${totals.analysed} analysed, ${totals.reused} already analysed, ` +
    `${totals.noCaptions} without captions, ${totals.failed} failed. ` +
    'Levels appear in Discover after the next catalogue run (within 15 minutes).',
);
