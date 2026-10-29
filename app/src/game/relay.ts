// The Gali relay client (server: relay/ at the repo root, a Cloudflare Durable Object).
//
// It speaks the small part of Supabase Realtime's channel API that world.ts, lobby.ts and arena.ts use
// (channel().on('broadcast', ...).subscribe(), send(), unsubscribe()), so those rooms move to the relay
// without changing how they work. One WebSocket carries every room plus the ORE board feed.
//
// Wire format is documented in relay/src/hub.ts.

type Status = 'SUBSCRIBED' | 'CLOSED' | 'CHANNEL_ERROR' | 'TIMED_OUT';
type Handler = (msg: { type: 'broadcast'; event: string; payload: any }) => void; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface OreFeedFrame {
  /** slot the accounts were read at */
  s: number;
  /** relay's clock when it read them (ms) */
  at: number;
  /** ORE Board account data, base64 */
  b: string;
  /** current Round account data, base64 (null before the round account exists) */
  r: string | null;
  /** chain wall-clock time of slot s in ms, sent every 30 s */
  bt?: number;
}

export class RelayChannel {
  private handlers = new Map<string, Handler[]>();
  private status: ((s: Status) => void) | null = null;
  joined = false;
  /** false once unsubscribe() is called: stops rejoins after a reconnect */
  wanted = false;

  private client: RelayClient;
  readonly topic: string;

  constructor(client: RelayClient, topic: string) {
    this.client = client;
    this.topic = topic;
  }

  on(_type: 'broadcast', filter: { event: string }, cb: Handler) {
    const list = this.handlers.get(filter.event) ?? [];
    list.push(cb);
    this.handlers.set(filter.event, list);
    return this;
  }

  subscribe(cb?: (s: Status) => void) {
    this.status = cb ?? null;
    this.wanted = true;
    this.client.join(this);
    return this;
  }

  async send(m: { type: 'broadcast'; event: string; payload: unknown }): Promise<'ok' | 'error'> {
    if (!this.joined) return 'error';
    return this.client.raw({ t: this.topic, e: m.event, p: m.payload }) ? 'ok' : 'error';
  }

  async unsubscribe(): Promise<'ok'> {
    this.wanted = false;
    this.joined = false;
    this.client.leave(this);
    return 'ok';
  }

  /** @internal */
  _status(s: Status) {
    this.joined = s === 'SUBSCRIBED';
    this.status?.(s);
  }

  /** @internal */
  _deliver(event: string, payload: unknown) {
    for (const h of this.handlers.get(event) ?? []) {
      try {
        h({ type: 'broadcast', event, payload });
      } catch (e) {
        console.warn('[gali] relay handler failed', e);
      }
    }
  }
}

interface WsLike {
  readyState: number;
  send(d: string): void;
  close(): void;
  onopen: ((ev: unknown) => void) | null;
  onclose: ((ev: unknown) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
}

const OPEN = 1;
const PING_MS = 25_000;

export class RelayClient {
  private ws: WsLike | null = null;
  private channels = new Map<string, RelayChannel>();
  private wantOre = false;
  private oreListeners = new Set<(f: OreFeedFrame) => void>();
  private retry = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  /** whether the socket has ever opened: the caller falls back to Supabase if it never does */
  everOpened = false;
  onOpenChange: ((open: boolean) => void) | null = null;
  lastOre: OreFeedFrame | null = null;
  lastOreAt = 0;

  readonly url: string;
  private makeSocket: (url: string) => WsLike;

  constructor(url: string, makeSocket: (url: string) => WsLike = (u) => new WebSocket(u) as unknown as WsLike) {
    this.url = url;
    this.makeSocket = makeSocket;
    this.connect();
  }

  get open() {
    return this.ws?.readyState === OPEN;
  }

  private connect() {
    if (this.closed) return;
    let ws: WsLike;
    try {
      ws = this.makeSocket(this.url);
    } catch {
      this.again();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.retry = 0;
      this.everOpened = true;
      this.onOpenChange?.(true);
      for (const ch of this.channels.values()) if (ch.wanted) this.raw({ j: ch.topic });
      if (this.wantOre) this.raw({ o: 1 });
      if (this.pingTimer) clearInterval(this.pingTimer);
      // answered by the relay's auto-response, which does not wake (or bill) the server
      this.pingTimer = setInterval(() => {
        if (this.ws === ws && ws.readyState === OPEN) ws.send('ping');
      }, PING_MS);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || typeof ev.data !== 'string' || ev.data === 'pong') return;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (Array.isArray(m.m)) {
        for (const item of m.m) {
          if (!Array.isArray(item) || typeof item[0] !== 'string' || typeof item[1] !== 'string') continue;
          this.channels.get(item[0])?._deliver(item[1], item[2]);
        }
      } else if (typeof m.ok === 'string') this.channels.get(m.ok)?._status('SUBSCRIBED');
      else if (typeof m.full === 'string') this.channels.get(m.full)?._status('CHANNEL_ERROR');
      else if (m.o && typeof m.o === 'object') {
        const f = m.o as OreFeedFrame;
        if (typeof f.s !== 'number' || typeof f.b !== 'string') return;
        this.lastOre = f;
        this.lastOreAt = Date.now();
        for (const l of this.oreListeners) l(f);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.onOpenChange?.(false);
      for (const ch of this.channels.values()) if (ch.joined) ch._status('CLOSED');
      this.again();
    };
    ws.onerror = () => {
      // onclose follows
    };
  }

  private again() {
    if (this.closed || this.retryTimer) return;
    // 1 s, 2 s, 4 s ... up to 15 s, with jitter so a relay restart is not met by everyone at once
    const wait = Math.min(15_000, 1000 * 2 ** this.retry) * (0.7 + Math.random() * 0.6);
    this.retry = Math.min(this.retry + 1, 6);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, wait);
  }

  /** Send one frame. False when the socket is not open. */
  raw(m: unknown): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== OPEN) return false;
    try {
      ws.send(JSON.stringify(m));
      return true;
    } catch {
      return false;
    }
  }

  channel(topic: string, _opts?: unknown): RelayChannel {
    const old = this.channels.get(topic);
    if (old) {
      old.wanted = false;
      this.channels.delete(topic);
    }
    const ch = new RelayChannel(this, topic);
    this.channels.set(topic, ch);
    return ch;
  }

  /** @internal */
  join(ch: RelayChannel) {
    this.channels.set(ch.topic, ch);
    this.raw({ j: ch.topic });
  }

  /** @internal */
  leave(ch: RelayChannel) {
    const cur = this.channels.get(ch.topic);
    if (cur === ch) this.channels.delete(ch.topic);
    // a newer channel for the same room keeps the socket in it
    else if (cur?.wanted) return;
    this.raw({ l: ch.topic });
  }

  /** Follow the ORE board feed. Returns a function that stops following. */
  followOre(cb: (f: OreFeedFrame) => void): () => void {
    this.oreListeners.add(cb);
    if (!this.wantOre) {
      this.wantOre = true;
      this.raw({ o: 1 });
    }
    if (this.lastOre) cb(this.lastOre);
    return () => {
      this.oreListeners.delete(cb);
      if (!this.oreListeners.size && this.wantOre) {
        this.wantOre = false;
        this.raw({ o: 0 });
      }
    };
  }

  disconnect() {
    this.closed = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      // already closed
    }
  }
}
