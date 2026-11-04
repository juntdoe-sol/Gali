// The relay's rooms, with no Cloudflare APIs in it so the tests can drive it directly.
//
// Wire format (JSON text frames):
//   client -> relay  {"j":topic}                  join a room
//                    {"l":topic}                  leave it
//                    {"t":topic,"e":event,"p":{}} broadcast to everyone else in the room
//                    {"o":1} / {"o":0}            start / stop the ORE board feed
//   relay -> client  {"ok":topic} / {"full":topic} answer to a join
//                    {"m":[[topic,event,payload],...]}  everything since the last flush
//                    {"o":{...}}                  the ORE board feed (see ore.ts)
//
// Why it is cheap: Cloudflare bills incoming WebSocket messages (1 request per 20) and not outgoing ones,
// so fanning a message out to 100 players costs the same as sending it to one. Position updates from the
// same player are merged inside a flush, so a slow phone never gets a backlog of stale positions.

export const TOPICS: Record<string, number> = {
  'gali-world': 150, // the ORE island
  'gali-lobby': 100, // LOBBY_CAP in app/src/game/lobbyMap.ts
  'gali-chat': 400,
  'gali-arena2': 60, // 12 fighters plus spectators
};
/** Events where only the newest message from each sender matters. */
const LATEST_ONLY = new Set(['state', 'st']);

export const LIMITS = {
  frameBytes: 16_384,
  sockets: 400,
  perIp: 30, // phones on one carrier or one venue Wi-Fi share an IP
  ratePerSec: 12, // Arena fighters send up to 8 a second
  burst: 24,
  /** all sockets from one IP together: 30 walking players need about 30 a second */
  ipRatePerSec: 60,
  ipBurst: 120,
  dropsBeforeClose: 300,
};

export interface Attachment {
  /** rooms this socket is in */
  t: string[];
  /** wants the ORE feed */
  o: boolean;
  /** caller's IP, for the per-IP cap */
  ip: string;
  /** the id each room last saw this socket use, so a dropped connection can say "bye" for it */
  ids: Record<string, string>;
}

export interface Sock {
  att: Attachment;
  send(data: string): void;
  close(code: number, reason: string): void;
  /** saves the attachment so it survives hibernation */
  save(): void;
}

interface Bucket {
  tokens: number;
  at: number;
  drops: number;
  dropsAt: number;
}

export class Hub {
  private rooms = new Map<string, Set<Sock>>();
  private out = new Map<Sock, unknown[][]>();
  /** index of the newest LATEST_ONLY entry per (receiver, topic, sender id), to merge in place */
  private latest = new Map<Sock, Map<string, number>>();
  private buckets = new WeakMap<Sock, Bucket>();
  private ipBuckets = new Map<string, Bucket>();
  private all = new Set<Sock>();

  private now: () => number;

  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  /** Rebuild rooms from the sockets Cloudflare kept while the object slept. */
  restore(socks: Sock[]) {
    for (const s of socks) {
      this.all.add(s);
      for (const t of s.att.t) this.room(t).add(s);
    }
  }

  get size() {
    return this.all.size;
  }

  countIp(ip: string) {
    let n = 0;
    for (const s of this.all) if (s.att.ip === ip) n++;
    return n;
  }

  /** May a new socket from this IP connect? */
  admits(ip: string) {
    return this.all.size < LIMITS.sockets && this.countIp(ip) < LIMITS.perIp;
  }

  add(s: Sock) {
    this.all.add(s);
  }

  feedWanted() {
    for (const s of this.all) if (s.att.o) return true;
    return false;
  }

  feedSockets() {
    return [...this.all].filter((s) => s.att.o);
  }

  counts() {
    return Object.fromEntries([...this.rooms].map(([t, r]) => [t, r.size]));
  }

  private room(t: string) {
    let r = this.rooms.get(t);
    if (!r) this.rooms.set(t, (r = new Set()));
    return r;
  }

  private allow(s: Sock): boolean {
    const now = this.now();
    let b = this.buckets.get(s);
    if (!b) this.buckets.set(s, (b = { tokens: LIMITS.burst, at: now, drops: 0, dropsAt: now }));
    b.tokens = Math.min(LIMITS.burst, b.tokens + ((now - b.at) / 1000) * LIMITS.ratePerSec);
    b.at = now;
    // one IP opening many sockets cannot multiply its allowance
    let ib = this.ipBuckets.get(s.att.ip);
    if (!ib) {
      if (this.ipBuckets.size > 5000) this.ipBuckets.clear();
      this.ipBuckets.set(s.att.ip, (ib = { tokens: LIMITS.ipBurst, at: now, drops: 0, dropsAt: now }));
    }
    ib.tokens = Math.min(LIMITS.ipBurst, ib.tokens + ((now - ib.at) / 1000) * LIMITS.ipRatePerSec);
    ib.at = now;
    if (b.tokens >= 1 && ib.tokens >= 1) {
      b.tokens -= 1;
      ib.tokens -= 1;
      return true;
    }
    if (now - b.dropsAt > 60_000) {
      b.drops = 0;
      b.dropsAt = now;
    }
    if (++b.drops > LIMITS.dropsBeforeClose) s.close(1008, 'too many messages');
    return false;
  }

  /** One frame from a client. Returns true when the ORE feed wish changed. */
  message(s: Sock, raw: string | ArrayBuffer): boolean {
    if (typeof raw !== 'string' || raw.length > LIMITS.frameBytes) return false;
    if (!this.allow(s)) return false;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(raw);
    } catch {
      return false;
    }
    if (!m || typeof m !== 'object') return false;
    if (typeof m.t === 'string' && typeof m.e === 'string' && m.e.length <= 16) {
      this.broadcast(s, m.t, m.e, m.p);
      return false;
    }
    if (typeof m.j === 'string') {
      this.join(s, m.j);
      return false;
    }
    if (typeof m.l === 'string') {
      this.leave(s, m.l, true);
      return false;
    }
    if (m.o === 1 || m.o === 0) {
      const want = m.o === 1;
      if (s.att.o === want) return false;
      s.att.o = want;
      s.save();
      return true;
    }
    return false;
  }

  join(s: Sock, t: string) {
    const cap = TOPICS[t];
    if (!cap) return s.send(JSON.stringify({ full: t }));
    const r = this.room(t);
    if (!r.has(s) && r.size >= cap) return s.send(JSON.stringify({ full: t }));
    r.add(s);
    if (!s.att.t.includes(t)) {
      s.att.t.push(t);
      s.save();
    }
    s.send(JSON.stringify({ ok: t }));
  }

  leave(s: Sock, t: string, save: boolean) {
    const r = this.rooms.get(t);
    if (r?.delete(s)) {
      const id = s.att.ids[t];
      // only when nobody else in the room is using that id: a copied id cannot be used to remove its owner
      if (id && ![...r].some((o) => o.att.ids[t] === id)) this.queue(r, null, t, 'bye', { id });
    }
    if (save) {
      s.att.t = s.att.t.filter((x) => x !== t);
      delete s.att.ids[t];
      s.save();
    }
  }

  /** The socket is gone: leave every room, telling each one who left. */
  drop(s: Sock) {
    for (const t of [...s.att.t]) this.leave(s, t, false);
    this.all.delete(s);
    this.out.delete(s);
    this.latest.delete(s);
  }

  private broadcast(s: Sock, t: string, e: string, p: unknown) {
    const r = this.rooms.get(t);
    if (!r || !r.has(s)) return;
    const id = p && typeof p === 'object' && typeof (p as { id?: unknown }).id === 'string' ? (p as { id: string }).id.slice(0, 32) : '';
    if (id && s.att.ids[t] !== id) {
      s.att.ids[t] = id;
      s.save();
    }
    this.queue(r, s, t, e, p, LATEST_ONLY.has(e) && id ? id : '');
  }

  private queue(r: Set<Sock>, from: Sock | null, t: string, e: string, p: unknown, mergeKey = '') {
    for (const to of r) {
      if (to === from) continue;
      let q = this.out.get(to);
      if (!q) this.out.set(to, (q = []));
      if (mergeKey) {
        let idx = this.latest.get(to);
        if (!idx) this.latest.set(to, (idx = new Map()));
        const k = `${t}\u0000${e}\u0000${mergeKey}`;
        const at = idx.get(k);
        if (at !== undefined) {
          q[at] = [t, e, p];
          continue;
        }
        idx.set(k, q.length);
      }
      q.push([t, e, p]);
    }
  }

  pending() {
    return this.out.size > 0;
  }

  /** Send each socket everything queued for it, as one frame. Returns how many frames went out. */
  flush(): number {
    let n = 0;
    for (const [s, q] of this.out) {
      if (!q.length) continue;
      try {
        s.send(JSON.stringify({ m: q }));
        n++;
      } catch {
        // a socket that closed mid-flush is dropped by its close event
      }
    }
    this.out.clear();
    this.latest.clear();
    return n;
  }
}
