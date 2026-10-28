// Run: node tests/rides.cjs
// The lobby's public rides: the fleet every phone agrees on, parking that never lands on a door, getting on
// and off seen by everyone, a newcomer told where the moved rides are, and two players grabbing one ride
// at once both ending up with the same winner.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const out = path.join(os.tmpdir(), 'gali-rides.cjs');
const entry = path.join(os.tmpdir(), 'gali-rides-entry.ts');
const src = path.join(__dirname, '../src/game');
fs.writeFileSync(
  entry,
  `export * from ${JSON.stringify(path.join(src, 'rides'))};\nexport * as R from ${JSON.stringify(path.join(src, 'rideRules'))};\nexport * as M from ${JSON.stringify(path.join(src, 'lobbyMap'))};\nexport { joinLobby, publishLobbyMe, useLobby } from ${JSON.stringify(path.join(src, 'lobby'))};\n`,
);
const S = (f) => path.join(__dirname, 'stubs', f);
const plugin = `{name:'stub',setup(b){b.onResolve({filter:/(^|\\/)sfx$/},()=>({path:${JSON.stringify(S('sfx.ts'))}}));b.onResolve({filter:/\\.\\/(world|storage|username)$/},a=>({path:{world:${JSON.stringify(S('world.ts'))},storage:${JSON.stringify(S('storage.ts'))},username:${JSON.stringify(S('username.ts'))}}[a.path.slice(2)]}))}}`;
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
function player(name) {
  globalThis.__bus = bus;
  globalThis.__mem = new Map();
  globalThis.__name = name;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  const P = m.exports;
  P.joinLobby();
  P.startRides();
  P.at = (x, y) => {
    P.pos = [x, y];
    P.rideMoved(x, y, 1);
    P.publishLobbyMe({ x, y, tx: x, ty: y, facing: 1, pose: 'idle', look, lvl: 1 });
  };
  return P;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const id = (P) => P.useLobby.getState().me;
const ride = (P, k) => P.useRides.getState().rides[k];

(async () => {
  // ---- the rules ----
  const A = player('Ana');
  const { R, M } = A;
  const map = M.lobbyMap();
  const homes = R.homes(map);
  assert.equal(homes.length, R.FLEET_MAX, 'a home for every ride');
  for (const [x, y] of homes) {
    assert.ok(M.standable(map, x, y), 'home is standable');
    assert.equal(M.doorAt(x, y), null, 'home is not a door');
  }
  assert.equal(new Set(homes.map(([x, y]) => `${x},${y}`)).size, homes.length, 'homes are all different');
  assert.deepEqual(R.homes(map), homes, 'same homes every time');
  assert.equal(R.fleetSize(1), 6);
  assert.equal(R.fleetSize(20), 14);
  assert.equal(R.fleetSize(100), 30);
  assert.ok(R.kindOf(0) === 'cart' && R.kindOf(1) === 'scoot', 'carts and scooters alternate');
  // parking on a door moves the ride off it
  const d = M.DOORS[0];
  const [dx, dy] = M.tileCentre(d.x + 1, d.y);
  const [px, py] = R.parkSpot(map, dx, dy);
  assert.equal(M.doorAt(px, py), null, 'never parks on a door');
  assert.ok(M.standable(map, px, py), 'parks somewhere standable');
  // water is no place for a cart
  const [wx, wy] = R.parkSpot(map, 1, 1);
  assert.ok(M.standable(map, wx, wy));
  assert.equal(R.claimWinner({ id: 'b', at: 5 }, { id: 'a', at: 9 }), 'b', 'earlier claim wins');
  assert.equal(R.claimWinner({ id: 'b', at: 5 }, { id: 'a', at: 5 }), 'a', 'tie: smaller id');
  const fleet = R.homeFleet(map);
  assert.equal(R.visible(fleet, 1).length, 6, 'one miner online sees 6 rides');
  const ridden = fleet.map((r) => (r.id === 25 ? { ...r, rider: 'x' } : r));
  assert.ok(R.visible(ridden, 1).some((r) => r.id === 25), 'a ridden ride never vanishes');
  const moved = fleet.map((r) => (r.id === 2 ? { ...r, x: r.x + 40, at: 1000 } : r));
  assert.equal(R.sendHome(map, moved, 1000 + R.RETURN_MS - 1), moved, 'not home yet');
  assert.equal(R.sendHome(map, moved, 1000 + R.RETURN_MS)[2].x, fleet[2].x, 'left alone, it goes home');
  assert.equal(R.asRideId(3), 3);
  assert.equal(R.asRideId(-1), null);
  assert.equal(R.asRideId(99), null);
  assert.equal(R.asRideId('2'), null);

  // ---- two players ----
  const B = player('Ben');
  await wait(30);
  const [h0x, h0y] = homes[0];
  A.at(h0x + 5, h0y);
  B.at(h0x + 200, h0y);
  await wait(30);
  assert.equal(A.useRides.getState().near, 0, 'A stands by ride 0');
  assert.equal(B.getOn(0), false, 'B is too far to get on');
  assert.equal(A.getOn(0), true, 'A gets on');
  assert.equal(A.getOn(1), false, 'one ride at a time');
  await wait(30);
  assert.equal(ride(B, 0).rider, id(A), 'B sees A on ride 0');
  assert.equal(B.getOn(0), false, 'a ridden ride is taken');
  // A rides off: the ride follows A on B's screen (position updates go out twice a second at most)
  await wait(550);
  A.at(h0x + 60, h0y + 30);
  await wait(30);
  assert.equal(Math.round(ride(B, 0).x), h0x + 60, 'ride follows its rider');
  A.getOff();
  await wait(30);
  assert.equal(ride(B, 0).rider, null, 'B sees it parked');
  assert.equal(ride(B, 0).x, ride(A, 0).x, 'both agree where');
  assert.equal(ride(B, 0).y, ride(A, 0).y);
  // a stranger cannot park someone else's ride
  A.at(h0x + 60, h0y + 30);
  A.getOn(0);
  await wait(30);
  const before = { ...ride(A, 0) };
  A.onRd({ id: 'mallory', r: 0, on: 0, x: 10, y: 10, at: Date.now() + 1 });
  assert.equal(ride(A, 0).rider, id(A), 'only the rider can park it');
  assert.equal(ride(A, 0).x, before.x);
  A.onRd({ id: 'mallory', r: 99, on: 1, at: Date.now() });
  A.onRd({ id: 'mallory', r: 'x', on: 1 });
  A.getOff();
  await wait(30);

  // ---- a newcomer hears where the moved rides are ----
  const C = player('Cat');
  await wait(1200);
  assert.equal(ride(C, 0).x, ride(A, 0).x, 'newcomer sees the moved ride where it is');
  assert.equal(ride(C, 0).y, ride(A, 0).y);
  assert.equal(ride(C, 0).rider, null);

  // ---- two grab one ride at the same moment: both phones agree on one winner ----
  const [h1x, h1y] = homes[1];
  A.at(h1x, h1y);
  B.at(h1x + 3, h1y);
  await wait(30);
  assert.equal(A.getOn(1), true);
  assert.equal(B.getOn(1), true, 'B has not heard yet');
  await wait(40);
  const rA = ride(A, 1).rider;
  const rB = ride(B, 1).rider;
  const rC = ride(C, 1).rider;
  assert.ok(rA && rA === rB && rB === rC, `one winner everywhere (${rA}, ${rB}, ${rC})`);
  const loser = rA === id(A) ? B : A;
  assert.equal(loser.useRides.getState().mine, null, 'the loser is off');

  // ---- a rider who walks out: the ride stays where they were last seen ----
  const winner = rA === id(A) ? A : B;
  await wait(550);
  winner.at(h1x + 40, h1y);
  await wait(30);
  winner.stopRides();
  await wait(30);
  assert.equal(ride(C, 1).rider, null, 'parked when its rider leaves');
  console.log('lobby rides passed');
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
