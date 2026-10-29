// Gali relay: one Cloudflare Durable Object that carries every shared room (island, lobby, chat, arena)
// and the ORE board feed, over one WebSocket per player.
//
// One object, not one per room, on purpose: the Workers Free plan allows 13,000 GB-s of Durable Object
// time a day, and one object awake all day uses 10,800 (128 MB x 86,400 s). WebSockets use the
// Hibernation API, so an empty relay costs nothing.

import { Hub, LIMITS, type Attachment, type Sock } from './hub.ts';
import { OreFeed, makeRpc } from './ore.ts';

export interface Env {
  HUB: DurableObjectNamespace;
  /** Full RPC URLs (with their keys), set with `wrangler secret put`. */
  HELIUS_RPC_URL?: string;
  ALCHEMY_RPC_URL?: string;
  /** Comma-separated web origins allowed to connect. Requests with no Origin (the Android app) are allowed. */
  ALLOWED_ORIGINS?: string;
}

const FLUSH_MS = 60;
const DEFAULT_ORIGINS = [
  'https://galiisland.bounded.page',
  'https://betatest.gali.lol',
  'https://gali.lol',
  'https://www.gali.lol',
  'http://localhost:8081',
];

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
      const origin = req.headers.get('Origin');
      const allowed = (env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_ORIGINS;
      if (origin && !allowed.includes(origin)) return new Response('origin not allowed', { status: 403 });
      return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    }
    if (url.pathname === '/health') return env.HUB.get(env.HUB.idFromName('main')).fetch(req);
    return new Response('Gali relay', { status: 200 });
  },
};

export class GaliHub implements DurableObject {
  private hub = new Hub();
  private feed: OreFeed;
  private socks = new Map<WebSocket, Sock>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private feedTimer: ReturnType<typeof setTimeout> | null = null;

  private ctx: DurableObjectState;

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    const urls = [env.HELIUS_RPC_URL, env.ALCHEMY_RPC_URL].filter((u): u is string => Boolean(u));
    this.feed = new OreFeed(makeRpc(urls));
    // keep-alive pings are answered without waking the object (and without billing a request)
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
    // woke up from hibernation: rebuild the rooms from the sockets Cloudflare kept
    this.hub.restore(ctx.getWebSockets().map((ws) => this.sock(ws)));
  }

  private sock(ws: WebSocket, att?: Attachment): Sock {
    let s = this.socks.get(ws);
    if (s) return s;
    const a: Attachment = att ?? ((ws.deserializeAttachment() as Attachment | null) || { t: [], o: false, ip: '', ids: {} });
    s = {
      att: a,
      send: (d) => ws.send(d),
      close: (c, r) => ws.close(c, r),
      save: () => ws.serializeAttachment(a),
    };
    this.socks.set(ws, s);
    return s;
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') {
      return Response.json(
        {
          sockets: this.hub.size,
          rooms: this.hub.counts(),
          feed: { ok: Boolean(this.feed.last), ageMs: this.feed.lastOkAt ? Date.now() - this.feed.lastOkAt : null, errors: this.feed.errors },
        },
        { headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' } },
      );
    }
    const ip = req.headers.get('CF-Connecting-IP') ?? '';
    if (!this.hub.admits(ip)) return new Response('relay full', { status: 503 });
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    this.ctx.acceptWebSocket(server);
    const att: Attachment = { t: [], o: false, ip, ids: {} };
    server.serializeAttachment(att);
    this.hub.add(this.sock(server, att));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, msg: string | ArrayBuffer) {
    const s = this.sock(ws);
    const feedChanged = this.hub.message(s, msg);
    if (feedChanged && s.att.o && this.feed.last) s.send(JSON.stringify({ o: this.feed.last }));
    if (this.hub.pending()) this.scheduleFlush();
    this.kickFeed();
  }

  async webSocketClose(ws: WebSocket, code: number) {
    this.gone(ws);
    try {
      ws.close(code === 1005 ? 1000 : code, 'bye');
    } catch {
      // already closed
    }
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }

  private gone(ws: WebSocket) {
    const s = this.socks.get(ws) ?? this.sock(ws);
    this.hub.drop(s);
    this.socks.delete(ws);
    if (this.hub.pending()) this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.hub.flush();
    }, FLUSH_MS);
  }

  /** Keep reading the board while anyone wants it; stop (and let the object sleep) when nobody does. */
  private kickFeed() {
    if (!this.hub.feedWanted()) {
      if (this.feedTimer) clearTimeout(this.feedTimer);
      this.feedTimer = null;
      return;
    }
    if (this.feed.due()) void this.readBoard();
    if (!this.feedTimer) {
      this.feedTimer = setTimeout(() => {
        this.feedTimer = null;
        this.kickFeed();
      }, 1000);
    }
  }

  private async readBoard() {
    const f = await this.feed.poll();
    if (!f) return;
    const frame = JSON.stringify({ o: f });
    for (const s of this.hub.feedSockets()) {
      try {
        s.send(frame);
      } catch {
        // closed; its close event cleans up
      }
    }
  }
}

export { LIMITS };
