// Run: node tests/juice.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const load = (f) => {
  const m = { exports: {} };
  new Function('module', 'exports', ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(m, m.exports);
  return m.exports;
};
const { landedSince, rumbleAmp, shouldCelebrate } = load('src/engine/juice.ts');
const z = () => Array(25).fill(0);
const w = (o) => Object.assign(z(), o);

assert.deepEqual(landedSince(null, w({ 7: 0.12 }), 0), [], 'first read of a round never bursts');
assert.deepEqual(landedSince(z(), z(), 0), [], 'no change, no label');
assert.deepEqual(landedSince(w({ 7: 0.05 }), w({ 7: 0.17 }), 0), [{ i: 7, add: 0.12 }].map((x) => ({ ...x, add: landedSince(w({ 7: 0.05 }), w({ 7: 0.17 }), 0)[0].add })));
assert.ok(Math.abs(landedSince(w({ 7: 0.05 }), w({ 7: 0.17 }), 0)[0].add - 0.12) < 1e-9);
assert.deepEqual(landedSince(z(), w({ 3: 0.5 }), 1 << 3), [], 'your own deploy is never announced as someone else');
assert.deepEqual(landedSince(w({ 1: 5 }), w({ 1: 0.2 }), 0), [], 'round rollover (pot shrinks) produces nothing');
assert.deepEqual(landedSince(z(), w({ 2: 0.0004 }), 0), [], 'dust below threshold ignored');
assert.deepEqual(landedSince(z(), z().slice(0, 24), 0), [], 'length mismatch ignored');
const many = landedSince(z(), w({ 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 }), 0);
assert.equal(many.length, 3, 'at most 3 labels');
assert.deepEqual(many.map((x) => x.i), [4, 3, 2], 'largest first');
console.log('PASS live deploy feed diff');

assert.equal(rumbleAmp(10_001, 10_000, 'mining', 1), 0, 'quiet before the lock window');
assert.equal(rumbleAmp(0, 10_000, 'mining', 1), 0, 'quiet once closed');
assert.equal(rumbleAmp(5_000, 10_000, 'settling', 1), 0, 'quiet outside mining');
assert.equal(rumbleAmp(5_000, 10_000, 'mining', 0), 0, 'off on low quality');
assert.ok(rumbleAmp(9_999, 10_000, 'mining', 1) > 0 && rumbleAmp(1, 10_000, 'mining', 1) < 2, 'under 2px');
assert.ok(rumbleAmp(1_000, 10_000, 'mining', 1) > rumbleAmp(9_000, 10_000, 'mining', 1), 'builds toward the lock');
console.log('PASS countdown rumble bounds');

assert.equal(shouldCelebrate(0, 0), false);
assert.equal(shouldCelebrate(0, undefined), false);
assert.equal(shouldCelebrate(5, 5), false, 'same stamp never repeats');
assert.equal(shouldCelebrate(5, 6), true);
console.log('PASS claim celebration trigger');

// Isolation: the cosmetic module must not reach wallet, chain or store code.
const src = fs.readFileSync(path.join(__dirname, '../src/engine/juice.ts'), 'utf8');
assert.ok(!/import /.test(src), 'juice.ts has no imports');
console.log('PASS cosmetic module is isolated');

// Engine wiring guards (source-level: the engine needs a canvas, so check the contract it must keep).
const eng = fs.readFileSync(path.join(__dirname, '../src/engine/engine.ts'), 'utf8');
assert.match(eng, /this\.landed = this\.landed\.filter\(\(x\) => x\.i !== l\.i\)/, 'one label per spot');
assert.match(eng, /this\.landed = this\.landed\.slice\(-3\)/, 'at most 3 labels');
assert.match(eng, /s\.roundId !== this\.potRound\) \{ this\.potRound = s\.roundId; this\.potPrev = null/, 'first read of a round never bursts');
assert.match(eng, /Math\.max\(-1, Math\.min\(1, Math\.round\(/, 'lock rumble is capped to one physical pixel');
assert.match(eng, /Math\.round\(\(cam\.ox \+ shake \* cam\.z\) \* dpr\) \+ rumblePx/, 'lock rumble is added after zoom, DPR and base rounding');
assert.match(eng, /lastRumbleDust > 480/, 'lock window emits bounded dust puffs');
assert.match(eng, /this\.mode === 'island'\) \{\s*this\.parts\.burst\('coin', me\.x/, 'claim spray only on the island');
const store = fs.readFileSync(path.join(__dirname, '../src/game/store.ts'), 'utf8');
const stamps = [...store.matchAll(/claimedAt: Date\.now\(\)/g)].length;
assert.equal(stamps, 1, 'claimedAt is stamped in exactly one place');
const at = store.indexOf('claimedAt: Date.now()');
assert.ok(store.lastIndexOf('claimBoardSol(displayed)', at) > store.lastIndexOf('catch (e)', at) - 4000 && store.lastIndexOf('} catch (e) {', at) < store.lastIndexOf('claimBoardSol(displayed)', at), 'stamp sits after the awaited claim, before the catch');
console.log('PASS engine wiring contract');
