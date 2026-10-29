// Run: node --test test/   (Node 22.13+, no packages needed)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hub, LIMITS, type Sock, type Attachment } from '../src/hub.ts';
import { OreFeed, type Rpc } from '../src/ore.ts';
import { b58decode, b58encode, boardAddressCheck, BOARD_ADDRESS, roundAddress } from '../src/solana.ts';
import { RelayClient } from '../../app/src/game/relay.ts';

/* ---------- helpers ---------- */
function fakeSock(ip = '1.1.1.1'): Sock & { got: any[]; closed: string | null } {
  const att: Attachment = { t: [], o: false, ip, ids: {} };
  const s = {
    att,
    got: [] as any[],
    closed: null as string | null,
    send(d: string) {
      s.got.push(JSON.parse(d));
    },
    close(_c: number, r: string) {
      s.closed = r;
    },
    save() {},
  };
  return s;
}
const msgs = (s: { got: any[] }) => s.got.filter((g) => g.m).flatMap((g) => g.m);

/* ---------- solana ---------- */
test('derives ORE board address and round-trips base58', async () => {
  assert.equal(await boardAddressCheck(), BOARD_ADDRESS);
  const k = 'SpLiT11111111111111111111111111111111111112';
  assert.equal(b58encode(b58decode(k)), k);
  const a = await roundAddress(1n);
  assert.equal(b58decode(a).length, 32);
  assert.equal(await roundAddress(1n), a); // cached and stable
});

/* ---------- hub ---------- */
test('broadcast reaches the room, not the sender, and not other rooms', () => {
  const h = new Hub();
  const [a, b, c] = [fakeSock(), fakeSock(), fakeSock()];
  for (const s of [a, b, c]) h.add(s);
  h.message(a, JSON.stringify({ j: 'gali-lobby' }));
  h.message(b, JSON.stringify({ j: 'gali-lobby' }));
  h.message(c, JSON.stringify({ j: 'gali-world' }));
  assert.deepEqual(a.got.at(-1), { ok: 'gali-lobby' });
  h.message(a, JSON.stringify({ t: 'gali-lobby', e: 'emote', p: { id: 'aa', e: 'wave' } }));
  h.flush();
  assert.deepEqual(msgs(b), [['gali-lobby', 'emote', { id: 'aa', e: 'wave' }]]);
  assert.equal(msgs(a).length, 0);
  assert.equal(msgs(c).length, 0);
});

test('only the newest position per player survives a flush; other events keep order', () => {
  const h = new Hub();
  const [a, b] = [fakeSock(), fakeSock()];
  h.add(a);
  h.add(b);
  for (const s of [a, b]) h.message(s, JSON.stringify({ j: 'gali-world' }));
  h.message(a, JSON.stringify({ t: 'gali-world', e: 'state', p: { id: 'aa', x: 1 } }));
  h.message(a, JSON.stringify({ t: 'gali-world', e: 'emote', p: { id: 'aa', e: '🔥' } }));
  h.message(a, JSON.stringify({ t: 'gali-world', e: 'state', p: { id: 'aa', x: 2 } }));
  h.flush();
  assert.deepEqual(msgs(b), [
    ['gali-world', 'state', { id: 'aa', x: 2 }],
    ['gali-world', 'emote', { id: 'aa', e: '🔥' }],
  ]);
});

test('a full room and an unknown room both refuse the join', () => {
  const h = new Hub();
  const cap = 60; // gali-arena2
  const socks = Array.from({ length: cap + 1 }, () => fakeSock());
  for (const s of socks) {
    h.add(s);
    h.message(s, JSON.stringify({ j: 'gali-arena2' }));
  }
  assert.deepEqual(socks[cap].got.at(-1), { full: 'gali-arena2' });
  const x = fakeSock();
  h.add(x);
  h.message(x, JSON.stringify({ j: 'not-a-room' }));
  assert.deepEqual(x.got.at(-1), { full: 'not-a-room' });
});

test('leaving or dropping says bye with the id the player used', () => {
  const h = new Hub();
  const [a, b] = [fakeSock(), fakeSock()];
  h.add(a);
  h.add(b);
  for (const s of [a, b]) h.message(s, JSON.stringify({ j: 'gali-lobby' }));
  h.message(a, JSON.stringify({ t: 'gali-lobby', e: 'state', p: { id: 'w-abc' } }));
  h.flush();
  h.drop(a);
  h.flush();
  assert.deepEqual(msgs(b).at(-1), ['gali-lobby', 'bye', { id: 'w-abc' }]);
  assert.equal(h.size, 1);
});

test('rate limit drops a flood and finally closes the socket', () => {
  let t = 0;
  const h = new Hub(() => t);
  const [a, b] = [fakeSock(), fakeSock()];
  h.add(a);
  h.add(b);
  for (const s of [a, b]) h.message(s, JSON.stringify({ j: 'gali-chat' }));
  for (let i = 0; i < LIMITS.burst + LIMITS.dropsBeforeClose + 5; i++) h.message(a, JSON.stringify({ t: 'gali-chat', e: 'chat', p: { i } }));
  h.flush();
  assert.ok(msgs(b).length <= LIMITS.burst, `got ${msgs(b).length}`);
  assert.equal(a.closed, 'too many messages');
});

test('oversized frames and junk are ignored', () => {
  const h = new Hub();
  const [a, b] = [fakeSock(), fakeSock()];
  h.add(a);
  h.add(b);
  for (const s of [a, b]) h.message(s, JSON.stringify({ j: 'gali-chat' }));
  h.message(a, JSON.stringify({ t: 'gali-chat', e: 'chat', p: 'x'.repeat(LIMITS.frameBytes) }));
  h.message(a, '{not json');
  h.flush();
  assert.equal(msgs(b).length, 0);
});

test('per-IP and total socket caps', () => {
  const h = new Hub();
  for (let i = 0; i < LIMITS.perIp; i++) h.add(fakeSock('9.9.9.9'));
  assert.equal(h.admits('9.9.9.9'), false);
  assert.equal(h.admits('8.8.8.8'), true);
});

/* ---------- ORE feed ---------- */
function boardB64(roundId: bigint, start: bigint, end: bigint) {
  const b = new Uint8Array(40);
  const dv = new DataView(b.buffer);
  dv.setBigUint64(8, roundId, true);
  dv.setBigUint64(16, start, true);
  dv.setBigUint64(24, end, true);
  return Buffer.from(b).toString('base64');
}

test('feed reads board + round in one call, and re-reads once on rollover', async () => {
  let roundId = 100n;
  const calls: string[] = [];
  const rpc: Rpc = async (method, params) => {
    calls.push(method);
    if (method === 'getBlockTime') return 1_700_000_000;
    const keys = (params[0] as string[]);
    return {
      context: { slot: 5000 },
      value: [{ data: [boardB64(roundId, 4900n, 5100n), 'base64'] }, keys[1] ? { data: [`round-of-${keys[1].slice(0, 4)}`, 'base64'] } : null],
    };
  };
  let t = 0;
  const f = new OreFeed(rpc, () => t);
  const first = await f.poll();
  assert.ok(first);
  assert.equal(first.s, 5000);
  assert.ok(first.r?.startsWith('round-of-'));
  assert.equal(first.bt, 1_700_000_000_000);
  assert.deepEqual(calls, ['getMultipleAccounts', 'getMultipleAccounts', 'getBlockTime']); // first read learns the round id
  calls.length = 0;
  t += 3000;
  await f.poll();
  assert.deepEqual(calls, ['getMultipleAccounts']); // steady state: one call
  calls.length = 0;
  roundId = 101n;
  t += 3000;
  const roll = await f.poll();
  assert.deepEqual(calls, ['getMultipleAccounts', 'getMultipleAccounts']);
  assert.ok(roll);
  assert.equal(f.interval(), 3000);
});

test('feed backs off on errors and waits longer before the first deploy', async () => {
  let fail = true;
  const rpc: Rpc = async (method) => {
    if (fail) throw new Error('429');
    if (method === 'getBlockTime') return null;
    return { context: { slot: 1 }, value: [{ data: [boardB64(7n, 0n, 0xffffffffffffffffn), 'base64'] }, null] };
  };
  const f = new OreFeed(rpc, () => 0);
  assert.equal(await f.poll(), null);
  assert.equal(f.errors, 1);
  fail = false;
  await f.poll();
  assert.equal(f.errors, 0);
  assert.equal(f.interval(), 5000); // round not started
});

/* ---------- app client <-> hub, end to end ---------- */
function connectPair(h: Hub, ip = '2.2.2.2') {
  const server = fakeSock(ip);
  const wire = { incoming: 0 };
  const client: any = {
    readyState: 0,
    onopen: null,
    onclose: null,
    onerror: null,
    onmessage: null,
    send(d: string) {
      if (d === 'ping') return; // answered by Cloudflare's auto-response
      wire.incoming++;
      queueMicrotask(() => h.message(server, d));
    },
    close() {
      client.readyState = 3;
      h.drop(server);
      client.onclose?.({});
    },
  };
  server.send = (d: string) => queueMicrotask(() => client.onmessage?.({ data: d }));
  h.add(server);
  queueMicrotask(() => {
    client.readyState = 1;
    client.onopen?.({});
  });
  return { client, server, wire };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('app RelayClient joins, broadcasts, reconnects and rejoins', async () => {
  const h = new Hub();
  const pairs: ReturnType<typeof connectPair>[] = [];
  const mk = () => {
    const p = connectPair(h);
    pairs.push(p);
    return p.client;
  };
  const A = new RelayClient('wss://x/ws', mk);
  const B = new RelayClient('wss://x/ws', mk);
  const seen: unknown[] = [];
  const statuses: string[] = [];
  const chA = A.channel('gali-lobby').subscribe();
  B.channel('gali-lobby')
    .on('broadcast', { event: 'state' }, ({ payload }) => seen.push(payload))
    .subscribe((s) => statuses.push(s));
  await tick();
  await tick();
  assert.equal(statuses[0], 'SUBSCRIBED');
  assert.equal(await chA.send({ type: 'broadcast', event: 'state', payload: { id: 'a1', x: 5 } }), 'ok');
  await tick();
  h.flush();
  await tick();
  assert.deepEqual(seen, [{ id: 'a1', x: 5 }]);

  // B's socket drops: channel reports CLOSED, then SUBSCRIBED again after the retry
  pairs[1].client.close();
  assert.equal(statuses.at(-1), 'CLOSED');
  await new Promise((r) => setTimeout(r, 1600));
  await tick();
  await tick();
  assert.equal(statuses.at(-1), 'SUBSCRIBED');
  A.disconnect();
  B.disconnect();
});

test('ORE feed reaches followers through the client', async () => {
  const h = new Hub();
  const C = new RelayClient('wss://x/ws', () => connectPair(h).client);
  const frames: any[] = [];
  C.followOre((f) => frames.push(f));
  await tick();
  await tick();
  const subs = h.feedSockets();
  assert.equal(subs.length, 1);
  subs[0].send(JSON.stringify({ o: { s: 9, at: 1, b: 'AAAA', r: null } }));
  await tick();
  assert.equal(frames[0].s, 9);
  C.disconnect();
});

/* ---------- 100 miners ---------- */
test('100 miners for 60 s: billable requests, frames and per-flush cost', async () => {
  const h = new Hub(() => clock);
  let clock = 0;
  const N = 100;
  const pairs = Array.from({ length: N }, (_, i) => connectPair(h, `10.0.${i >> 5}.${i}`));
  const clients = pairs.map((p) => new RelayClient('wss://x/ws', () => p.client));
  await tick();
  // 60 in the lobby, 30 on the island, 10 in the arena; everyone in chat
  const room = (i: number) => (i < 60 ? 'gali-lobby' : i < 90 ? 'gali-world' : 'gali-arena2');
  const chats = clients.map((c) => c.channel('gali-chat').subscribe());
  const chans = clients.map((c, i) => c.channel(room(i)).subscribe());
  await tick();
  await tick();
  for (const p of pairs) p.wire.incoming = 0;

  // 1 in 4 walking (1 update/s), the rest beat every 15 s (lobby) / 12 s (island); arena fighters 8/s (arena.ts sends every 120 ms while moving);
  // 6 chat lines a minute across everyone
  const seconds = 60;
  let flushes = 0;
  let flushMs = 0;
  let frames = 0;
  for (let ms = 0; ms < seconds * 1000; ms += 60) {
    clock = ms;
    for (let i = 0; i < N; i++) {
      const r = room(i);
      const walking = i % 4 === 0;
      const every = r === 'gali-arena2' ? 125 : walking ? 1000 : r === 'gali-lobby' ? 15_000 : 12_000;
      if ((ms + i * 37) % every < 60) void chans[i].send({ type: 'broadcast', event: r === 'gali-arena2' ? 'st' : 'state', payload: { id: `p${i}`, x: ms % 500, y: i } });
    }
    if (ms % 10_000 < 60) void chats[Math.floor(ms / 10_000) % N].send({ type: 'broadcast', event: 'chat', payload: { id: 'p1', t: 'gm' } });
    await tick();
    const t0 = performance.now();
    if (h.pending()) {
      frames += h.flush();
      flushes++;
    }
    flushMs += performance.now() - t0;
    await tick();
  }
  const incoming = pairs.reduce((a, p) => a + p.wire.incoming, 0);
  const perSec = incoming / seconds;
  const billedPerSec = perSec / 20;
  const peakDay3h = billedPerSec * 3 * 3600;
  console.log(
    JSON.stringify(
      {
        players: N,
        incomingMsgPerSec: +perSec.toFixed(1),
        billedRequestsPerSec: +billedPerSec.toFixed(2),
        billedFor3hPeak: Math.round(peakDay3h),
        billedFor24h: Math.round(billedPerSec * 86_400),
        framesOutPerSec: +(frames / seconds).toFixed(1),
        avgFlushMs: +(flushMs / Math.max(1, flushes)).toFixed(3),
      },
      null,
      1,
    ),
  );
  assert.ok(peakDay3h < 100_000, '3-hour peak fits the free 100,000 daily requests');
  for (const c of clients) c.disconnect();
});
