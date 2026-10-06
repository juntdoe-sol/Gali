// Run: node tests/live-clock-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const hud = fs.readFileSync(path.join(__dirname, '../src/ui/Hud.tsx'), 'utf8');
const store = fs.readFileSync(path.join(__dirname, '../src/game/store.ts'), 'utf8');

assert.match(store, /liveClockError:/, 'store exposes live clock failure state');
assert.match(store, /catch\(\(e\) => \{[\s\S]{0,400}liveClockError:/, 'clock poll records errors');
assert.match(store, /liveClock: \{ roundId,[\s\S]{0,200}liveClockError: null/, 'successful poll clears errors');
assert.match(store, /set\(\{ liveClock: \{ roundId,[\s\S]{0,240}void b\.oreSoloMask\(roundId\)\.then/, 'clock commits before optional solo-mask work');
assert.match(store, /\.catch\(\(\) => undefined\)/, 'optional solo-mask failure cannot discard a valid ORE clock');
assert.match(hud, /const syncing = liveMode && !liveClock/, 'connected live without a clock is an explicit sync state');
assert.match(hud, /'BOARD OFFLINE'/, 'failed clock never says NOT STARTED');
assert.match(hud, /'SYNCING'/, 'initial clock load is visible');
assert.match(hud, /liveClock \? `#\$\{\(roundId % 100000\)/, 'local fallback round is hidden until ORE clock exists');
assert.doesNotMatch(hud, /clockPhase === 'waiting' \? 'NOT STARTED'/, 'waiting is not used as a silent error fallback');
console.log('PASS live clock failure is explicit; fake fallback round hidden');
