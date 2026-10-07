// Run: node tests/lobby.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/game/lobbyMap.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(m, m.exports);
const L = m.exports;
const map = L.lobbyMap();
assert.equal(map, L.lobbyMap(), 'built once');
assert.equal(map.terrain.length, L.LCOLS * L.LROWS);

// every spawn is standable, and every door can be reached from every spawn
for (const [k, [tx, ty]] of Object.entries(L.SPAWNS)) assert.ok(L.isFree(map, tx, ty), `spawn ${k} is free`);
for (const d of L.DOORS) for (let y = d.y; y < d.y + d.h; y++) for (let x = d.x; x < d.x + d.w; x++) assert.ok(L.isFree(map, x, y), `door ${d.id} tile ${x},${y} free`);
for (const [k, [tx, ty]] of Object.entries(L.SPAWNS)) {
  const [sx, sy] = L.tileCentre(tx, ty);
  for (const d of L.DOORS) {
    const [dx, dy] = L.tileCentre(d.x + 1, d.y);
    const p = L.lobbyPath(map, sx, sy, dx, dy);
    assert.ok(p.length > 0, `path ${k} -> ${d.id}`);
    const last = p[p.length - 1];
    assert.equal(L.doorAt(last[0], last[1]), d.id, `path ${k} ends in door ${d.id}`);
    // every waypoint is standable
    p.forEach(([x, y]) => assert.ok(L.standable(map, x, y), 'waypoint standable'));
  }
}
// the spawn is not already a door (arriving must not bounce you out)
for (const [k, [tx, ty]] of Object.entries(L.SPAWNS)) assert.equal(L.doorAt(...L.tileCentre(tx, ty)), null, `spawn ${k} not a door`);

// a free-standing area big enough for a crowd: count tiles you can stand on
let free = 0;
for (let i = 0; i < map.block.length; i++) if (!map.block[i]) free++;
assert.ok(free > 1800, `room for a crowd: ${free} free tiles`);
// same inputs, same route
const a = L.lobbyPath(map, 580, 560, 120, 200);
const b = L.lobbyPath(map, 580, 560, 120, 200);
assert.deepEqual(a, b);
// tapping a tree or water walks to the nearest standable spot, never into it
const w = L.lobbyPath(map, 580, 560, 1100, 100);
if (w.length) { const e = w[w.length - 1]; assert.ok(L.standable(map, e[0], e[1])); }
// names and chat are cleaned
assert.equal(L.cleanName('  Bad<script>  Name!! '), 'Badscript Name');
assert.equal(L.cleanName('a'), '');
assert.equal(L.cleanName(5), '');
assert.equal(L.cleanChat('hi\u0000 there\n friend').length > 0, true);
assert.equal(L.cleanChat('x'.repeat(200)).length, 80);
console.log('lobby map ok, free tiles:', free, 'trees:', map.trees.length);
