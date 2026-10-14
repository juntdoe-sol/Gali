// Run: node tests/brawl.cjs
// Brawl step 1 on a fake realtime bus: hits land only in range and at a fair rate, damage agrees on both
// sides, a KO knocks down and pays the winner XP once, standing up brings a shield, and Brawl off or a
// deploy in progress means nobody can hit you.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const out = path.join(os.tmpdir(), 'gali-brawl.cjs');
const entry = path.join(os.tmpdir(), 'gali-brawl-entry.ts');
const src = path.join(__dirname, '../src/game');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(src, 'brawl'))};\nexport { joinLobby, publishLobbyMe, useLobby } from ${JSON.stringify(path.join(src, 'lobby'))};\n`);
const S = (f) => path.join(__dirname, 'stubs', f);
const plugin = `{name:'stub',setup(b){b.onResolve({filter:/\\.\\/(world|storage|username)$/},a=>({path:{world:${JSON.stringify(S('world.ts'))},storage:${JSON.stringify(S('storage.ts'))},username:${JSON.stringify(S('username.ts'))}}[a.path.slice(2)]}))}}`;
const script = `require(${JSON.stringify(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] }))}).build({entryPoints:[${JSON.stringify(entry)}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(out)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',plugins:[${plugin}]})`;
fs.writeFileSync(out + '.build.cjs', script);
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
function player(name, lvl, pos) {
  globalThis.__bus = bus;
  globalThis.__mem = new Map();
  globalThis.__name = name;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  const P = m.exports;
  P.xp = 0;
  P.busy = false;
  P.pos = pos;
  P.initBrawl({ busy: () => P.busy, level: () => lvl, canFight: () => true, gainXp: (n) => (P.xp += n) });
  P.enterScope('lobby');
  P.joinLobby();
  P.move = (x, y) => {
    P.pos = [x, y];
    P.setMyPos('lobby', x, y);
  };
  P.say = () => P.publishLobbyMe({ x: P.pos[0], y: P.pos[1], tx: P.pos[0], ty: P.pos[1], facing: 1, pose: 'idle', look, lvl });
  P.move(...pos);
  return P;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const id = (P) => P.useLobby.getState().me;

(async () => {
  // pure rules first
  const B0 = player('X', 1, [0, 0]);
  assert.ok([...Array(50).keys()].every((n) => { const d = B0.dmgOf('abc', n); return d >= 10 && d <= 15; }), 'damage 10 to 15');
  assert.equal(B0.dmgOf('abc', 7), B0.dmgOf('abc', 7), 'damage is the same everywhere');
  const r0 = { off: false, day: '', dayXp: 0, foes: {} };
  assert.equal(B0.koXp(r0, { now: 1e12, foeKeys: ['a'], myLvl: 5, foeLvl: 5 }).xp, 20, 'even fight pays 20');
  assert.equal(B0.koXp(r0, { now: 1e12, foeKeys: ['a'], myLvl: 20, foeLvl: 1 }).xp, 5, 'beating a much weaker miner pays a quarter');
  assert.equal(B0.koXp(r0, { now: 1e12, foeKeys: ['a'], myLvl: 1, foeLvl: 30 }).xp, 30, 'beating a stronger miner pays up to 1.5x');
  const r1 = B0.koXp(r0, { now: 1e12, foeKeys: ['a'], myLvl: 5, foeLvl: 5 }).rec;
  assert.equal(B0.koXp(r1, { now: 1e12 + 60_000, foeKeys: ['a'], myLvl: 5, foeLvl: 5 }).xp, 0, 'same foe within 10 minutes pays nothing');
  assert.equal(B0.koXp(r1, { now: 1e12 + 11 * 60_000, foeKeys: ['a'], myLvl: 5, foeLvl: 5 }).xp, 20, 'after 10 minutes it pays again');
  const capped = { off: false, day: new Date(1e12).toISOString().slice(0, 10), dayXp: 195, foes: {} };
  assert.equal(B0.koXp(capped, { now: 1e12, foeKeys: ['z'], myLvl: 5, foeLvl: 5 }).xp, 5, 'daily cap 200');
  assert.ok(!B0.hitOk({ claim: [0, 0], seen: [0, 0], me: [100, 0], lastFrom: 0, now: 1e6 }), 'out of reach');
  assert.ok(!B0.hitOk({ claim: [0, 0], seen: [200, 0], me: [10, 0], lastFrom: 0, now: 1e6 }), 'claimed position far from where we saw them');
  assert.ok(!B0.hitOk({ claim: [0, 0], seen: [0, 0], me: [10, 0], lastFrom: 1e6 - 100, now: 1e6 }), 'too fast');
  assert.ok(B0.hitOk({ claim: [0, 0], seen: [5, 0], me: [15, 0], lastFrom: 0, now: 1e6 }), 'a fair hit');
  bus.rooms = {};

  // two players in the lobby, standing next to each other
  const A = player('ALICE', 5, [100, 100]);
  const B = player('BOB', 5, [112, 100]);
  await wait(30);
  A.say();
  B.say();
  await wait(30);
  assert.equal(A.useBrawl.getState().peers[id(B)]?.on, true, 'Alice sees Bob is in Brawl');
  // Bob's shield from arriving is still up: nobody can hit him for 3 seconds
  assert.ok(A.useBrawl.getState().peers[id(B)].shieldUntil > Date.now(), 'arrival shield is visible to others');
  await wait(3100);
  B.say();
  await wait(30);

  // a swing out of reach does nothing
  A.move(300, 100);
  assert.equal(A.swing('lobby', id(B), 300, 100), true);
  await wait(30);
  assert.equal(B.useBrawl.getState().me.hp, 100, 'a hit from far away is refused');
  A.move(100, 100);
  A.say();
  await wait(520);

  // in reach: each swing lands, and both sides agree on the HP
  let hits = 0;
  while (B.useBrawl.getState().me.hp > 0 && hits < 20) {
    assert.equal(A.swing('lobby', id(B), 100, 100), true);
    assert.equal(A.swing('lobby', id(B), 100, 100), false, 'a second swing straight away does not count');
    hits++;
    await wait(470);
    const bHp = B.useBrawl.getState().me.hp;
    if (bHp > 0) assert.ok(Math.abs(A.useBrawl.getState().peers[id(B)].hp - bHp) <= 15, 'both sides agree, within a hit');
  }
  assert.ok(hits >= 7 && hits <= 10, `KO after 7 to 10 hits (took ${hits})`);
  await wait(60);
  assert.ok(B.useBrawl.getState().me.koAt > 0, 'Bob is knocked down');
  assert.ok(A.useBrawl.getState().peers[id(B)].koAt > 0, 'Alice sees the knockdown');
  assert.equal(A.xp, 20, 'Alice got 20 XP for the KO');
  assert.equal(B.xp, 0);
  assert.ok(A.useLobby.getState().feed.some((f) => f.k === 'ko' && f.tn === 'BOB'), 'the feed says who knocked out whom');

  // knocked down: Bob can't swing, and hits on him are ignored
  assert.equal(B.swing('lobby', id(A), 112, 100), false, 'no swinging while knocked down');

  // he stands up with full HP and a shield
  await wait(3100);
  assert.equal(B.useBrawl.getState().me.hp, 100);
  assert.equal(B.useBrawl.getState().me.koAt, 0);
  assert.equal(B.useBrawl.getState().me.respawn, 1, 'the canvas is told to put him back at the spawn');
  assert.ok(B.useBrawl.getState().me.shieldUntil > Date.now(), 'shield after standing up');
  A.swing('lobby', id(B), 100, 100);
  await wait(40);
  assert.equal(B.useBrawl.getState().me.hp, 100, 'shielded: no damage');

  // Brawl off: Alice sees it and can't hit him
  await wait(3000);
  B.useBrawl.getState().setOff(true);
  await wait(40);
  assert.equal(A.useBrawl.getState().peers[id(B)].on, false, 'Alice sees Brawl is off for Bob');
  await wait(450);
  A.swing('lobby', id(B), 100, 100);
  await wait(40);
  assert.equal(B.useBrawl.getState().me.hp, 100, 'Brawl off: no damage');
  B.useBrawl.getState().setOff(false);

  // a deploy in progress: safe
  B.busy = true;
  await wait(500);
  A.say();
  B.say();
  await wait(600);
  A.swing('lobby', id(B), 100, 100);
  await wait(40);
  assert.equal(B.useBrawl.getState().me.hp, 100, 'deploying: no damage');
  B.busy = false;

  // the same foe again soon after: the fight still works, but no more XP
  await wait(500);
  B.say();
  await wait(30);
  hits = 0;
  while (B.useBrawl.getState().me.hp > 0 && hits < 20) {
    A.swing('lobby', id(B), 100, 100);
    hits++;
    await wait(470);
  }
  await wait(60);
  assert.ok(B.useBrawl.getState().me.koAt > 0, 'second knockdown');
  assert.equal(A.xp, 20, 'no XP for the same foe within 10 minutes');

  console.log('brawl tests passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
