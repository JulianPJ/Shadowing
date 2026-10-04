import { WebSocket } from 'ws';
import { createDirectYoutubeCaptions } from '../src/lib/providers/youtube-captions';
import { logPreparationError } from '../src/lib/providers/errors';

const token = process.env.YOUTUBE_CAPTION_RELAY_TOKEN;
if (!token || token.length < 32)
  throw new Error('Set YOUTUBE_CAPTION_RELAY_TOKEN to a random secret of at least 32 characters.');
const endpoint = new URL('/connect', process.env.YOUTUBE_CAPTION_RELAY_URL ?? '');
if (
  endpoint.protocol !== 'https:' &&
  endpoint.hostname !== 'localhost' &&
  endpoint.hostname !== '127.0.0.1'
)
  throw new Error('Relay connection requires HTTPS.');
endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
const captions = createDirectYoutubeCaptions();
const cache = new Map<
  string,
  { expires: number; result: Awaited<ReturnType<typeof captions.transcribe>> }
>();
const active = new Map<string, AbortController>();
let stopping = false;
let backoff = 1000;
let connection: WebSocket;

function connect() {
  connection = new WebSocket(endpoint, {
    headers: { Authorization: `Bearer ${token}` },
    maxPayload: 1024,
  });
  const socket = connection;
  let heartbeat: ReturnType<typeof setInterval>;
  socket.on('open', () => {
    backoff = 1000;
    console.log('Caption relay connected');
    heartbeat = setInterval(() => {
      if (socket.readyState === WebSocket.OPEN) socket.send('ping');
    }, 30000);
  });
  socket.on('error', () =>
    console.error('Caption relay connection failed; check the URL, token and network.'),
  );
  socket.on('close', () => {
    clearInterval(heartbeat);
    for (const controller of active.values()) controller.abort();
    if (!stopping) {
      console.log('Caption relay disconnected; reconnecting');
      setTimeout(connect, backoff);
      backoff = Math.min(backoff * 2, 30000);
    }
  });
  socket.on('message', async (raw) => {
    if (raw.toString() === 'pong') return;
    let input;
    try {
      input = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (!input || typeof input !== 'object') return;
    if (typeof input.cancel === 'string') {
      active.get(input.cancel)?.abort();
      return;
    }
    const { id, videoId } = input;
    if (
      typeof id !== 'string' ||
      id.length > 64 ||
      active.has(id) ||
      typeof videoId !== 'string' ||
      !/^[a-zA-Z0-9_-]{11}$/.test(videoId)
    )
      return;
    const reply = (status: number, body: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ id, status, body }));
    };
    if (active.size >= 2) {
      reply(503, { code: 'network', error: 'Relay is busy' });
      return;
    }
    const hit = cache.get(videoId);
    if (hit && hit.expires > Date.now()) {
      reply(200, { videoId, ...hit.result });
      return;
    }
    const controller = new AbortController();
    active.set(id, controller);
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
    try {
      const result = await captions.transcribe(videoId, signal);
      if (cache.size >= 50) cache.delete(cache.keys().next().value!);
      cache.set(videoId, { expires: Date.now() + 60 * 60 * 1000, result });
      reply(200, { videoId, ...result });
    } catch (error) {
      const failure = logPreparationError(error, {
        stage: 'captions',
        provider: captions.name,
        videoId,
        signal,
      });
      reply(
        failure.code === 'no-japanese-captions'
          ? 422
          : failure.code === 'video-unavailable'
            ? 404
            : 503,
        failure,
      );
    } finally {
      active.delete(id);
    }
  });
}
connect();
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    stopping = true;
    connection.close();
    process.exit();
  });
