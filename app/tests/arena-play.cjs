// Run: node tests/arena-play.cjs
// Playing with each other in the arena: emotes reach everyone, a dizzy miner can be grabbed and thrown
// (and a healthy one can't), and in a Boss Raid a downed teammate is got back up by standing over them.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const out = path.join(os.tmpdir(), 'gali-arena-play.cjs');
const entry = path.join(os.tmpdir(), 'gali-arena-play-entry.ts');
const src = path.join(__dirname, '../src/game');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(src, 'arena'))};\nexport { initBrawl, swing, strike, useBrawl, setMyPos, guard, takeThrow } from ${JSON.stringify(path.join(src, 'brawl'))};\nexport { POWERS } from ${JSON.stringify(path.join(src, 'powers'))};\n`);
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
  await wait(30);
  A.at(150, 198);
  B.at(162, 198);
  await wait(300);
  // ---- emotes
  assert.equal(A.emote('wave'), true);
  await wait(40);
  assert.deepEqual(B.useArena.getState().emotes.map((e) => [e.id, e.e]), [['a1', 'wave']], 'B sees the wave');
  assert.equal(A.emote('laugh'), false, 'not twice in a row so fast');
  A.useArena.setState({ emoteOpen: true });
  await wait(720);
  assert.equal(A.emote('heart'), true);
  assert.equal(A.useArena.getState().emoteOpen, false, 'picking one closes the picker');
  // ---- wait for the fight (Last Miner Standing)
  for (let i = 0; i < 60 && A.useArena.getState().match.phase !== 'fight'; i++) await wait(150);
  await wait(150);
  assert.equal(B.useArena.getState().match.phase, 'fight');
  assert.equal(B.useArena.getState().match.mode, 'lms');
  A.at(150, 198);
  B.at(162, 198);
  await wait(300);
  // the arrival shield wears off
  for (const P of [A, B]) P.useBrawl.setState((s) => ({ me: { ...s.me, shieldUntil: 0 } }));
  // healthy: the grab is refused
  assert.equal(A.tryGrab('b2'), true);
  await wait(60);
  assert.equal(A.useArena.getState().holding, null, 'a healthy miner says no');
  assert.equal(B.useArena.getState().heldBy, null);
  // dizzy: grabbed and thrown
  B.useBrawl.setState((s) => ({ me: { ...s.me, hp: 30 } }));
  B.useArena.setState({ thrown: null });
  await wait(2600); // the same grabber can't try again at once
  // just hit (so no HP comes back yet), and A sees that
  B.useBrawl.setState((s) => ({ me: { ...s.me, hp: 30, hitAt: Date.now() } }));
  A.useBrawl.setState((s) => ({ peers: { ...s.peers, b2: { ...s.peers.b2, hp: 30, shieldUntil: 0, koAt: 0, on: true } } }));
  assert.equal(A.grabbable(), 'b2', 'B is dizzy and in reach');
  assert.equal(A.tryGrab('b2'), true);
  await wait(60);
  assert.equal(B.useArena.getState().heldBy?.id, 'a1', 'B is carried');
  assert.equal(A.useArena.getState().holding?.ok, true, 'A carries B');
  assert.equal(A.throwHeld(1), true);
  await wait(60);
  assert.equal(B.useArena.getState().heldBy, null);
  assert.equal(B.useArena.getState().thrown?.d, 1, 'thrown to the right');
  assert.equal(B.useBrawl.getState().me.hp, 30 - A.THROW_DMG, 'the throw hurts');
  // too far: refused
  B.at(260, 198);
  await wait(2700);
  B.useBrawl.setState((s) => ({ me: { ...s.me, hp: 20, hitAt: Date.now() } }));
  A.tryGrab('b2');
  await wait(60);
  assert.equal(B.useArena.getState().heldBy, null, 'out of reach');

  // ---- Boss Raid: down and back up
  const now = Date.now();
  const raid = (P) => P.useArena.setState((s) => ({ spectator: false, match: { ...s.match, host: 'a1', mode: 'boss', phase: 'fight', endsAt: now + 60_000, fighters: ['a1', 'b2'], out: [], boss: { x: 450, y: 198, hp: 9999, max: 9999, atk: null, atkAt: 0, hitDone: false, lastAtk: now + 30_000, hitAt: 0, facing: -1 } } }));
  raid(A);
  raid(B);
  assert.equal(B.downMode(), true);
  assert.equal(B.grabbable(), null, 'no grabbing teammates in a raid');
  A.at(100, 198);
  B.at(108, 198);
  await wait(200);
  B.useBrawl.setState((s) => ({ me: { ...s.me, hp: 100, koAt: 0, shieldUntil: 0 } }));
  B.takeThrow('arena', 999, [90, 198], 'boss');
  assert.ok(B.useBrawl.getState().me.koAt > 0, 'B is down');
  assert.ok(B.useArena.getState().downAt > 0, 'and waits for help');
  await wait(3600);
  assert.ok(B.useBrawl.getState().me.koAt > 0, 'still down after the usual 3 s');
  // too quick: refused
  A.shareRevive('b2', 'on');
  await wait(300);
  A.shareRevive('b2', 'done');
  await wait(60);
  assert.ok(B.useBrawl.getState().me.koAt > 0, 'a revive that skipped the wait does not count');
  // the real thing
  A.shareRevive('b2', 'on');
  await wait(60);
  assert.equal(B.useArena.getState().revives.length, 1, 'B sees A getting them up');
  await wait(A.REVIVE_MS);
  A.shareRevive('b2', 'done');
  await wait(60);
  assert.equal(B.useBrawl.getState().me.koAt, 0, 'B is back up');
  assert.equal(B.useBrawl.getState().me.hp, A.REVIVE_HP);
  assert.equal(B.useArena.getState().downAt, 0);
  console.log('arena play: emotes, grab and throw, raid revive all OK');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
