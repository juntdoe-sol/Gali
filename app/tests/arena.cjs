// Run: node tests/arena.cjs
// The arena on a fake realtime bus: everyone agrees on one host, matches run count -> fight -> end and
// rotate modes, a KO in Last Miner Standing sends you to the stands and the last one standing wins
// (with XP), pickups go to whoever the host says, and players can bring the Two-Mouthed down.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const out = path.join(os.tmpdir(), 'gali-arena.cjs');
const entry = path.join(os.tmpdir(), 'gali-arena-entry.ts');
const src = path.join(__dirname, '../src/game');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(src, 'arena'))};\nexport { initBrawl, swing, strike, useBrawl, setMyPos, guard } from ${JSON.stringify(path.join(src, 'brawl'))};\nexport { POWERS } from ${JSON.stringify(path.join(src, 'powers'))};\n`);
const S = (f) => path.join(__dirname, 'stubs', f);
const plugin = `{name:'stub',setup(b){b.onResolve({filter:/\\.\\/(world|storage|username)$/},a=>({path:{world:${JSON.stringify(S('world.ts'))},storage:${JSON.stringify(S('storage.ts'))},username:${JSON.stringify(S('username.ts'))}}[a.path.slice(2)]}))}}`;
fs.writeFileSync(out + '.build.cjs', `require(${JSON.stringify(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] }))}).build({entryPoints:[${JSON.stringify(entry)}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(out)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',plugins:[${plugin}]})`);
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
function player(name, id, lvl = 5) {
  globalThis.__bus = bus;
  globalThis.__mem = new Map();
  globalThis.__name = name;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  const P = m.exports;
  P.xp = 0;
  P.useArena.setState({ me: id });
  P.initBrawl({ busy: () => false, level: () => lvl, canFight: (scope) => { const a = P.useArena.getState(); return scope !== 'arena' || (a.open && a.match.phase === 'fight' && a.match.fighters.includes(a.me) && !a.spectator); }, gainXp: (n) => (P.xp += n) });
  P.initArena({ level: () => lvl, look: () => look, wallet: () => null, gainXp: (n) => (P.xp += n) });
  P.useArena.getState().show();
  P.at = (x, y) => {
    P.setMyPos('arena', x, y);
    P._arenaTest.setMyPos(x, y);
    P.publishArenaMe({ x, y, tx: x, ty: y, facing: 1, pose: 'idle' });
  };
  return P;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function hitUntilDown(A, B, x, y) {
  let n = 0;
  while (!B.useBrawl.getState().me.koAt && n < 25) {
    A.swing('arena', B.useArena.getState().me, x, y);
    n++;
    await wait(470);
  }
  return n;
}

(async () => {
  const A = player('ALICE', 'a1', 9);
  const B = player('BOB', 'b2', 5);
  const C = player('CARA', 'c3', 5);
  await wait(30);
  A.at(150, 130);
  B.at(162, 130);
  C.at(240, 150);
  await wait(200);
  for (const P of [A, B, C]) assert.equal(P.hostId(), 'a1', 'everyone agrees on the host (smallest id)');
  // the host starts a match: Last Miner Standing first, with everyone in it
  await wait(400);
  for (const P of [A, B, C]) {
    const m = P.useArena.getState().match;
    assert.equal(m.mode, 'lms');
    assert.equal(m.phase, 'count');
    assert.deepEqual(m.fighters, ['a1', 'b2', 'c3']);
  }
  // nobody can fight during the countdown
  assert.equal(A.swing('arena', 'b2', 150, 130), false, 'no swinging before the fight starts');
  await wait(5200);
  assert.equal(B.useArena.getState().match.phase, 'fight');
  assert.ok(A.useArena.getState().pickups.length >= 4, 'pickups appear when the fight starts');
  assert.deepEqual(B.useArena.getState().pickups.map((p) => p.i), A.useArena.getState().pickups.map((p) => p.i), 'everyone sees the same pickups');

  // Bob walks over a pickup: the host gives it to him
  const it = B.useArena.getState().pickups[0];
  B.at(it.x, it.y);
  await wait(150);
  B.grab(it.i);
  await wait(150);
  assert.ok(!A.useArena.getState().pickups.some((p) => p.i === it.i), 'the pickup is gone for the host');
  assert.ok(!C.useArena.getState().pickups.some((p) => p.i === it.i), 'and for everyone else');
  const bob = B.useArena.getState();
  assert.ok(bob.ammo === 3 || B.useBrawl.getState().me.shieldUntil > Date.now() || it.k === 'heart', `Bob got the ${it.k}`);
  B.useBrawl.setState((s) => ({ me: { ...s.me, shieldUntil: 0 } }));

  // Alice knocks Bob out: he goes to the stands, and is out of the match
  B.at(162, 130);
  await wait(200);
  const n1 = await hitUntilDown(A, B, 150, 130);
  assert.ok(n1 >= 6 && n1 <= 10, `KO took ${n1} hits (level 9 hits a little harder)`);
  await wait(200);
  assert.equal(B.useArena.getState().spectator, true, 'Bob is in the stands');
  assert.ok(A.useArena.getState().match.out.includes('b2'), 'the host marked Bob out');
  assert.ok(C.useArena.getState().match.out.includes('b2'), 'everyone knows');
  assert.equal(B.swing('arena', 'a1', 162, 130), false, 'a spectator cannot swing');

  // Alice knocks Cara out too: last one standing wins
  C.at(162, 132);
  await wait(200);
  await hitUntilDown(A, C, 150, 130);
  await wait(500);
  for (const P of [A, B, C]) {
    const m = P.useArena.getState().match;
    assert.equal(m.phase, 'end');
    assert.equal(m.winner, 'a1');
    assert.equal(m.winnerName, 'ALICE');
  }
  assert.equal(A.xp, 27 + 27 + 50, 'two arena KOs (40 each, x0.68 for beating lower levels) and the win (50)');
  assert.equal(B.xp, 0);

  // the next match: King of the Hill, everyone back in
  await wait(6300);
  for (const P of [A, B, C]) {
    const m = P.useArena.getState().match;
    assert.equal(m.mode, 'koth', 'modes rotate');
    assert.equal(m.phase, 'count');
    assert.equal(P.useArena.getState().spectator, false, 'everyone fights again');
  }
  await wait(5200);
  // Cara alone on the throne (the high middle ledge) scores
  A.at(60, 198);
  B.at(300, 198);
  C.at(240, 118);
  await wait(1600);
  const sc = A.useArena.getState().match.score.c3 ?? 0;
  assert.ok(sc >= 1, `Cara scores on the throne (${sc}s)`);
  assert.ok(!(A.useArena.getState().match.score.a1 > 0), 'nobody else does');

  // a thrown shard reaches across the pit; a swing does not
  B.useBrawl.setState((s) => ({ me: { ...s.me, shieldUntil: 0, hp: 100 } }));
  A.at(60, 130);
  B.at(200, 130);
  await wait(200);
  assert.equal(A.strike('arena', 'swing', 'b2', 200, 130), true);
  await wait(60);
  assert.equal(B.useBrawl.getState().me.hp, 100, 'a "swing" claimed from far away is refused');
  await wait(400);
  assert.equal(A.strike('arena', 'ore', 'b2', 196, 126), true);
  await wait(60);
  const afterOre = B.useBrawl.getState().me.hp;
  assert.ok(afterOre < 100 && afterOre >= 100 - 9, `a shard hits for 8 plus Alice's level bonus (${100 - afterOre})`);
  // Pickaxe Guard: a fifth of the damage, and the attacker gets stung
  A.at(188, 130);
  await wait(200);
  B.guard();
  const aHp = A.useBrawl.getState().me.hp;
  A.swing('arena', 'b2', 188, 130);
  await wait(80);
  assert.ok(afterOre - B.useBrawl.getState().me.hp <= 4, 'guarding takes a fifth');
  assert.equal(aHp - A.useBrawl.getState().me.hp, 5, 'the guard stings the attacker for 5');

  // the Two-Mouthed's attacks catch by where you stand: the sweep is low, the tongue reaches far ahead,
  // the roar is all round
  const G = A.GROUND;
  assert.equal(A.bossCatches('sweep', 300, -1, 270, G), true, 'sweep: on the floor next to it');
  assert.equal(A.bossCatches('sweep', 300, -1, 270, G - 30), false, 'sweep: jumped over it');
  assert.equal(A.bossCatches('sweep', 300, -1, 200, G), false, 'sweep: out of reach');
  assert.equal(A.bossCatches('tongue', 300, -1, 190, G), true, 'tongue: far ahead on the floor');
  assert.equal(A.bossCatches('tongue', 300, -1, 190, 118), false, 'tongue: not up on the throne');
  assert.equal(A.bossCatches('tongue', 300, -1, 360, G), false, 'tongue: not behind it');
  assert.equal(A.bossCatches('roar', 300, -1, 360, G), true, 'roar: behind it too');

  // a solo player gets the boss, and can bring it down
  for (const P of [A, B, C]) P.useArena.getState().close();
  bus.rooms = {};
  const D = player('DAN', 'd4', 20);
  await wait(400);
  assert.equal(D.useArena.getState().match.mode, 'boss', 'alone: the boss');
  await wait(5200);
  const boss = D.useArena.getState().match.boss;
  assert.ok(boss && boss.hp === 400, 'boss HP for one player');
  D.hurtBoss(400);
  await wait(400);
  assert.equal(D.useArena.getState().match.phase, 'end');
  assert.equal(D.useArena.getState().match.winner, 'boss-down');
  assert.equal(D.xp, 30, 'boss down pays everyone who fought');

  console.log('arena tests passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
