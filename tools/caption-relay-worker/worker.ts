import { readBoundedText, BodyLimitError } from '../../src/lib/http-body';
import { DurableObject } from 'cloudflare:workers';
import type { InferEnv } from 'cf/config';
import type { worker } from './cloudflare.config';

type RelayEnv = InferEnv<typeof worker>;
type RelayReply = { id: string; status: number; body: Record<string, unknown> };
type Pending = { resolve: (reply: RelayReply) => void; socket: WebSocket; videoId: string };

// One coordination object per relay host, rather than request state in Worker globals.
export class CaptionRelay extends DurableObject<RelayEnv> {
  private pending = new Map<string, Pending>();

  constructor(ctx: DurableObjectState, env: RelayEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/connect' && request.headers.get('Upgrade')?.toLowerCase() === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server, ['host']);
      // Reconnection replaces the old host; pending work fails cleanly and can be retried by the caller.
      for (const socket of this.ctx.getWebSockets('host')) {
        if (socket !== server) {
          this.disconnect(socket);
          socket.close(1000, 'Host reconnected');
        }
      }
      return new Response(null, { status: 101, webSocket: client });
    }
    const socket = this.ctx.getWebSockets('host').find((ws) => ws.readyState === WebSocket.OPEN);
    if (path === '/health')
      return Response.json({ connected: !!socket, pending: this.pending.size });
    if (path !== '/captions' || request.method !== 'POST')
      return new Response('Not found', { status: 404 });
    if (!socket)
      return Response.json(
        { code: 'network', error: 'Caption relay host is offline' },
        { status: 503 },
      );
    if (this.pending.size >= 2)
      return Response.json({ code: 'network', error: 'Caption relay is busy' }, { status: 503 });
    if (!request.body) return Response.json({ code: 'invalid-url' }, { status: 400 });
    let raw: string;
    try {
      raw = await readBoundedText(request, 1024);
    } catch (error) {
      if (error instanceof BodyLimitError)
        return new Response('Payload too large', { status: 413 });
      throw error;
    }
    let videoId: string;
    try {
      videoId = JSON.parse(raw).videoId;
      if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId))
        throw new Error('Invalid ID');
    } catch {
      return Response.json({ code: 'invalid-url' }, { status: 400 });
    }
    // Another request can take a slot while this request reads its body.
    if (this.pending.size >= 2)
      return Response.json({ code: 'network', error: 'Caption relay is busy' }, { status: 503 });
    const id = crypto.randomUUID();
    const started = Date.now();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const reply = await new Promise<RelayReply>((resolve) => {
        this.pending.set(id, { resolve, socket, videoId });
        cancel = () => {
          resolve({ id, status: 504, body: { code: 'network-timeout' } });
          if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ cancel: id }));
        };
        timeout = setTimeout(cancel, 11000);
        request.signal.addEventListener('abort', cancel, { once: true });
        if (request.signal.aborted) {
          cancel();
          return;
        }
        socket.send(JSON.stringify({ id, videoId }));
      });
      console.info(
        JSON.stringify({
          event: 'caption-relay.result',
          videoId,
          status: reply.status,
          code: reply.body.code,
          elapsedMs: Date.now() - started,
        }),
      );
      return Response.json(reply.body, {
        status: reply.status,
        headers: { 'Cache-Control': 'no-store' },
      });
    } finally {
      clearTimeout(timeout);
      if (cancel) request.signal.removeEventListener('abort', cancel);
      this.pending.delete(id);
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== 'string' || message.length > 2_000_000) {
      socket.close(1009, 'Invalid message size');
      return;
    }
    let reply: RelayReply;
    try {
      reply = JSON.parse(message);
    } catch {
      socket.close(1003, 'Invalid message');
      return;
    }
    if (!reply || typeof reply !== 'object') {
      socket.close(1003, 'Invalid message');
      return;
    }
    const waiting = this.pending.get(reply.id);
    if (!waiting || waiting.socket !== socket) return;
    if (
      ![200, 400, 404, 422, 503, 504].includes(reply.status) ||
      !reply.body ||
      typeof reply.body !== 'object' ||
      (reply.status === 200 && reply.body.videoId !== waiting.videoId)
    ) {
      waiting.resolve({ id: reply.id, status: 502, body: { code: 'provider-incompatible' } });
      return;
    }
    waiting.resolve(reply);
  }

  private disconnect(socket: WebSocket) {
    for (const [id, waiting] of this.pending) {
      if (waiting.socket === socket)
        waiting.resolve({ id, status: 503, body: { code: 'network' } });
    }
  }
  webSocketClose(socket: WebSocket) {
    this.disconnect(socket);
  }
  webSocketError(socket: WebSocket) {
    this.disconnect(socket);
  }
}

const captionRelayWorker = {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const supplied = new TextEncoder().encode(request.headers.get('Authorization') ?? '');
    const expected = new TextEncoder().encode(`Bearer ${env.YOUTUBE_CAPTION_RELAY_TOKEN}`);
    if (
      !env.YOUTUBE_CAPTION_RELAY_TOKEN ||
      supplied.byteLength !== expected.byteLength ||
      !crypto.subtle.timingSafeEqual(supplied, expected)
    ) {
      return new Response('Unauthorized', { status: 401 });
    }
    return env.CAPTION_RELAY.getByName('primary-host').fetch(request);
  },
};
export default captionRelayWorker;
