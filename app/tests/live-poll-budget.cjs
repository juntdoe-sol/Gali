// Run: node tests/live-poll-budget.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../src/game/store.ts'), 'utf8');
const clock = Number(src.match(/const LIVE_CLOCK_POLL_MS = ([\d_]+)/)?.[1]?.replaceAll('_',''));
const pot = Number(src.match(/const LIVE_POT_POLL_MS = ([\d_]+)/)?.[1]?.replaceAll('_',''));
assert.ok(clock >= 10_000, 'clock poll must be >=10s; countdown runs locally');
assert.ok(pot >= 6_000, 'pot poll must be >=6s');
// fetchClock costs 2 RPC reads; fetchBoardRound costs 1. Stay under 24 reads/min/client.
const rpm = 60_000 / clock * 2 + 60_000 / pot;
assert.ok(rpm <= 24, `live polling budget ${rpm}/min exceeds 24`);
assert.match(src, /let livePotBusy = false/);
assert.match(src, /if \(!livePotBusy && Date\.now\(\) - st\.potAt > LIVE_POT_POLL_MS \* idleFactor\(\)\)/);
assert.match(src, /livePotBusy = true;[\s\S]{0,160}\.finally\(\(\) => \{ livePotBusy = false; \}\)/, 'pot poll cannot overlap itself');
console.log(`PASS live polling budget ${rpm}/min/client with overlap guard`);
