// Run: node tests/arena-host.cjs
// The arena host is chosen among players holding a ticket from Gali's server: an id of '0' or a forged ticket can no
// longer take the seat, everyone agrees on the same host, and with nobody ticketed the old smallest-id rule applies.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const { Keypair } = require(require.resolve('@solana/web3.js', { paths: [path.join(__dirname, '..')] }));
const out = path.join(os.tmpdir(), 'gali-arena-host.cjs');
const entry = path.join(os.tmpdir(), 'gali-arena-host-entry.ts');
const src = path.join(__dirname, '../src/game');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(src, 'arena'))};\nexport { initBrawl } from ${JSON.stringify(path.join(src, 'brawl'))};\nexport { idFor } from ${JSON.stringify(path.join(src, 'peerId'))};\n`);
const seed = new Uint8Array(32).fill(7);
const ticketPub = Keypair.fromSeed(seed).publicKey.toBase58();
const S = (f) => path.join(__dirname, 'stubs', f);
const plugin = `{name:'stub',setup(b){b.onResolve({filter:/(^|\\/)sfx$/},()=>({path:${JSON.stringify(S('sfx.ts'))}}));b.onResolve({filter:/^\\.\\/play$/},()=>({path:${JSON.stringify(S('play.ts'))}}));b.onResolve({filter:/\\.\\/(world|storage|username)$/},a=>({path:{world:${JSON.stringify(S('world.ts'))},storage:${JSON.stringify(S('storage.ts'))},username:${JSON.stringify(S('username.ts'))}}[a.path.slice(2)]}))}}`;
fs.writeFileSync(out + '.build.cjs', `require(${JSON.stringify(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] }))}).build({entryPoints:[${JSON.stringify(entry)}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(out)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',define:{'process.env.EXPO_PUBLIC_TICKET_KEY':${JSON.stringify(JSON.stringify(ticketPub))}},plugins:[${plugin}]})`);
execFileSync(process.execPath, [out + '.build.cjs'], { stdio: 'inherit' });
const code = fs.readFileSync(out, 'utf8');

const bus = {
  rooms: {},
  join(name, h, ch) { (this.rooms[name] ??= []).push({ h, ch }); },
  leave(name, ch) { this.rooms[name] = (this.rooms[name] || []).filter((r) => r.ch !== ch); },
  send(name, from, ev, payload) {
    for (const r of this.rooms[name] || []) if (r.ch !== from && r.h[ev]) setTimeout(() => r.h[ev]({ payload: JSON.parse(JSON.stringify(payload)) }), 2);
  },
};
const look = { hat: 'hat-yellow', fit: '#2f5fd0', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none', sex: 'm' };
globalThis.__miners = new Set();
function player(name, wallet, id) {
  globalThis.__bus = bus;
  globalThis.__mem = new Map();
  globalThis.__name = name;
  globalThis.__wallet = wallet;
  globalThis.__ticketSeed = seed;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  const P = m.exports;
  P.initBrawl({ busy: () => false, level: () => 5, canFight: () => true, gainXp: () => undefined });
  P.initArena({ level: () => 5, look: () => look, wallet: () => wallet, gainXp: () => undefined });
  P.useArena.setState({ me: id ?? P.idFor(wallet, 'guest000') });
  P.useArena.getState().show();
  P.at = () => P.publishArenaMe({ x: 300, y: 200, tx: 300, ty: 200, facing: 1, pose: 'idle' });
  return P;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const say = async (ps) => {
  for (let i = 0; i < 4; i++) {
    for (const p of ps) p.at();
    await wait(140);
  }
};

(async () => {
  const w1 = Keypair.generate().publicKey.toBase58();
  const w2 = Keypair.generate().publicKey.toBase58();
  const wx = Keypair.generate().publicKey.toBase58();
  globalThis.__miners.add(w1);
  globalThis.__miners.add(w2);
  // nobody ticketed yet (tickets still being fetched): the smallest id hosts, as before
  const X = player('MALLORY', null, '0'); // the old trick: the smallest possible id
  await wait(30);
  assert.equal(X.hostId(), '0', 'alone and unticketed, the old rule still runs the hall');
  const A = player('ALICE', w1);
  const B = player('BOB', w2);
  const G = player('GUEST', wx); // a wallet that never played ORE: no ticket
  await wait(30);
  await say([A, B, G, X]);
  await wait(300);
  await say([A, B, G, X]);
  await wait(60);
  const views = [A, B, G, X].map((p) => p.hostId());
  assert.ok(new Set(views).size === 1, `everyone agrees on one host (${views.join(', ')})`);
  assert.ok([A, B].map((p) => p.useArena.getState().me).includes(views[0]), 'the host is a ticketed ORE miner, not id 0 or the guest');
  assert.ok(A.useArena.getState().peers[B.useArena.getState().me].ticketExp > Date.now(), 'tickets travel with the state packets');
  assert.equal(A.useArena.getState().peers[G.useArena.getState().me].ticketExp, 0, 'no ticket for a wallet that never played ORE');

  // a forged ticket (signed with some other key) is not believed
  const fake = Keypair.generate();
  const { ed25519 } = await import('@noble/curves/ed25519.js');
  const id = '0';
  const exp = Date.now() + 3600_000;
  const sig = Buffer.from(ed25519.sign(new TextEncoder().encode(`gali-ticket|${wx}|${id}|${exp}`), fake.secretKey.slice(0, 32))).toString('base64');
  bus.send('gali-arena2', null, 'st', { id, nm: 'MALLORY', x: 1, y: 1, tx: 1, ty: 1, f: 1, p: 'idle', sp: 0, v: 2, h: 'hat-yellow', c: '#2f5fd0', k: '#c9c9c9', hd: '#9b6b43', g: 'none', sx: 'm', lvl: 5, tr: 'plain', w: wx, tk: { exp, sig } });
  await wait(30);
  assert.equal(A.useArena.getState().peers['0'].ticketExp, 0, 'a forged ticket is ignored');
  assert.equal(A.hostId(), views[0], 'and the host does not change');

  // the host's word is checked: a match naming fighters who are not in the hall is ignored
  const before = A.useArena.getState().match.n;
  bus.send('gali-arena2', null, 'm', { h: A.hostId(), n: 999, mode: 'lms', ph: 'end', left: 1000, fi: ['ghost1', 'ghost2'], out: [], sc: {}, win: 'ghost1', wn: 'GHOST', boss: null, mb: [], wv: null });
  await wait(30);
  assert.notEqual(A.useArena.getState().match.n, 999, 'a match with made-up fighters is refused');
  assert.ok(A.useArena.getState().match.n === before || A.useArena.getState().match.n < 999);
  console.log('arena-host: all passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
