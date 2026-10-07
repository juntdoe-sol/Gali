// Run: node tests/dig.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/game/dig.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(m, m.exports);
const d = m.exports;

const w = d.newWall('2026-10-07', 3, 1);
assert.equal(w.tiles.length, 16);
assert.equal(w.tiles.filter((t) => t.find === 'gem').length, 1, 'one gem a wall');
assert.equal(w.tiles.filter((t) => t.find === 'nugget').length, 3, 'three nuggets a wall');
assert.ok(w.tiles.every((t) => t.max >= 1 && t.max <= 3 && t.hp === t.max));
assert.deepEqual(d.newWall('2026-10-07', 3, 1), w, 'same day, spot and depth give the same wall');
assert.notDeepEqual(d.newWall('2026-10-07', 4, 1).tiles, w.tiles, 'other spots get other walls');

let s = d.enter(d.freshDig('2026-10-07'), 3);
assert.equal(s.swings, d.DAILY_SWINGS);
assert.equal(d.enter(s, 3), s, 're-entering the same spot keeps the wall');
assert.equal(d.deeper(s), s, 'no going deeper before the gem');

// break a plain rock: costs one swing per hit, pays only when it breaks
const rock = s.wall.tiles.findIndex((t) => t.find === 'rock');
let xp = 0;
for (let i = s.wall.tiles[rock].max; i > 0; i--) {
  const r = d.hit(s, rock);
  assert.ok(r.ok);
  assert.equal(r.found, i === 1 ? 'rock' : null);
  xp += r.xp; s = r.state;
}
assert.equal(xp, d.XP_ROCK);
assert.equal(d.hit(s, rock).ok, false, 'a broken rock cannot be hit again');

// the gem pays, locks the wall, and opens the next depth
const gem = s.wall.tiles.findIndex((t) => t.find === 'gem');
let last;
while (s.wall.tiles[gem].hp > 0) { last = d.hit(s, gem); s = last.state; }
assert.equal(last.xp, d.XP_GEM);
assert.ok(d.gemFound(s.wall));
assert.equal(d.hit(s, s.wall.tiles.findIndex((t) => t.hp > 0)).ok, false, 'wall is finished once the gem is out');
const before = s.swings;
s = d.deeper(s);
assert.equal(s.wall.depth, 2);
assert.equal(s.swings, before, 'going deeper is free');

// swings: run out, top up, cap, new day
assert.equal(d.hit({ ...s, swings: 0 }, 0).ok, false, 'no swings, no hit');
assert.equal(d.addSwings({ ...s, swings: 95 }, d.ROUND_SWINGS).swings, d.MAX_SWINGS);
assert.equal(d.addSwings(s, -5).swings, s.swings);
const next = d.rollDigDay({ ...s, swings: 2 }, '2026-10-08');
assert.deepEqual(next, d.freshDig('2026-10-08'));

// saves: damage survives, layout cannot be forged, junk is refused
const back = d.parseDig(JSON.stringify(s), '2026-10-07');
assert.deepEqual(back, s);
const forged = JSON.parse(JSON.stringify(s));
forged.wall.tiles.forEach((t) => { t.find = 'gem'; t.hp = 99; });
assert.equal(d.parseDig(JSON.stringify(forged), '2026-10-07').wall.tiles.filter((t) => t.find === 'gem').length, 1);
assert.deepEqual(d.parseDig(JSON.stringify({ ...s, swings: 5000 }), '2026-10-07'), d.freshDig('2026-10-07'));
assert.deepEqual(d.parseDig('{nope', '2026-10-07'), d.freshDig('2026-10-07'));
console.log('PASS dig');
