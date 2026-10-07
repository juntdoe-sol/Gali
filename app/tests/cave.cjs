// Run: node tests/cave.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const m = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/game/cave.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(m, m.exports);
const c = m.exports;

for (let depth = 1; depth <= 12; depth++) {
  for (let seed = 1; seed <= 60; seed++) {
    const lv = c.makeLevel(depth, c.seededRand(seed * 97 + depth));
    const reach = c.reachable(lv.cells, lv.start);
    assert.ok(reach[c.idx(...lv.ladder)], `ladder reachable d${depth} s${seed}`);
    assert.equal(lv.cells[c.idx(...lv.start)], c.FLOOR);
    assert.equal(lv.cells[c.idx(...lv.ladder)], c.FLOOR);
    const loot = lv.loot.filter(Boolean);
    assert.ok(loot.filter((l) => l === 'gem').length >= 1, 'a gem every floor');
    assert.ok(loot.filter((l) => l === 'oil').length >= 2, 'oil every floor');
    lv.loot.forEach((l, i) => { if (l) assert.ok(lv.cells[i] === c.ROCK && reach[i], 'loot sits in a reachable rock'); });
    lv.cells.forEach((k, i) => assert.ok(k === c.ROCK ? lv.hp[i] >= 1 && lv.hp[i] <= 3 : lv.hp[i] === 0, 'rock hp 1-3, nothing else has hp'));
    assert.equal(lv.bats.length, Math.min(6, depth));
  }
}
assert.deepEqual(c.makeLevel(3, c.seededRand(5)), c.makeLevel(3, c.seededRand(5)), 'same seed, same cave');
assert.equal(c.rockfallEvery(1), 0, 'floor one is calm');
assert.ok(c.rockfallEvery(5) < c.rockfallEvery(2));

let s = c.freshCave('2026-10-07');
assert.equal(s.runs, c.DAILY_RUNS);
s = c.spendRun(s);
assert.equal(s.runs, c.DAILY_RUNS - 1);
assert.equal(c.spendRun({ ...s, runs: 0 }).runs, 0, 'no runs, no spend');
assert.equal(c.addRuns({ ...s, runs: 9 }, 1).runs, c.MAX_RUNS);
assert.equal(c.addRuns(s, -3).runs, s.runs);
s = c.recordDepth(s, 4);
assert.equal(c.recordDepth(s, 2).best, 4);
const next = c.rollCaveDay({ ...s, runs: 0 }, '2026-10-08');
assert.deepEqual(next, { day: '2026-10-08', runs: c.DAILY_RUNS, best: 4 });
assert.deepEqual(c.parseCave(JSON.stringify(s), '2026-10-07'), s);
assert.deepEqual(c.parseCave(JSON.stringify({ ...s, runs: 500 }), '2026-10-07'), c.freshCave('2026-10-07'));
assert.deepEqual(c.parseCave('{nope', '2026-10-07'), c.freshCave('2026-10-07'));
console.log('PASS cave');
