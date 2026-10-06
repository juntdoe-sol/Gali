// Run: node tests/expedition.cjs (uses the installed TypeScript compiler).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const source = path.join(__dirname, '../src/game/expedition.ts');
assert.ok(fs.existsSync(source), 'expedition rules must exist');
const mod = { exports: {} };
new Function('module', 'exports', ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(mod, mod.exports);
const e = mod.exports;
const day = '2026-10-06';
for (const mine of ['crystal', 'tunnel', 'seam']) {
  const a = e.startExpedition(day, mine, 'standard', 1000);
  assert.deepEqual(a, e.startExpedition(day, mine, 'standard', 1000), 'daily layout deterministic');
  assert.equal(a.cells.length, 25);
  assert.notDeepEqual(a.cells, e.startExpedition('2026-10-07', mine, 'standard', 1000).cells, 'day changes layout');
}
assert.notDeepEqual(e.startExpedition(day, 'crystal', 'standard', 0).cells, e.startExpedition(day, 'seam', 'standard', 0).cells);
console.log('PASS deterministic daily layouts: all three mines');
assert.equal(typeof e.act, 'function', 'excavation actions must exist');
let run = e.startExpedition(day, 'crystal', 'standard', 1000);
assert.equal(e.act(run, { tile: 0, tool: 'pickaxe' }, 1100).stamina, run.stamina, 'nonadjacent rejected');
assert.equal(e.adjacent(4, 5), false, 'no row wrapping');
run.cells[17] = { rock: 'relic', hp: 2, broken: false };
const gentle = e.act(run, { tile: 17, tool: 'shovel' }, 1100);
assert.equal(gentle.position, 17); assert.equal(gentle.relics, 1); assert.equal(gentle.stamina, 27);
const drilled = e.act(run, { tile: 17, tool: 'drill' }, 1100);
assert.equal(drilled.relics, 0); assert.equal(drilled.damaged, 1); assert.equal(drilled.stamina, 25);
run.cells[17] = { rock: 'basalt', hp: 6, broken: false };
assert.equal(e.act(run, { tile: 17, tool: 'drill' }, 1100).cells[17].hp, 0);
assert.equal(e.act(run, { tile: 17, tool: 'pickaxe' }, 1100).cells[17].hp, 3);
assert.equal(e.act(run, { tile: 17, tool: 'shovel' }, 1100).cells[17].hp, 5);
assert.equal(e.act({ ...run, stamina: 0 }, { tile: 17, tool: 'drill' }, 1100).cells[17].hp, 6);
const out = e.act(gentle, 'extract', 1200);
assert.equal(out.status, 'extracted'); assert.ok(out.score > 0);
assert.deepEqual(e.act(out, { tile: 12, tool: 'drill' }, 1300), out, 'terminal run immutable');
const timeout = e.act(gentle, 'extract', gentle.deadline);
assert.equal(timeout.status, 'timeout'); assert.equal(timeout.score, 0);
assert.equal(e.act(gentle, 'tick', gentle.deadline).status, 'timeout');
console.log('PASS route adjacency, stamina, all tools, fragile damage, extract, timeout');
assert.equal(typeof e.recordBest, 'function', 'persistent best-score mastery rules must exist');
const empty = { v: 1, best: {} };
const saved = e.recordBest(empty, out);
assert.equal(e.mastery(saved).xp, out.score);
assert.deepEqual(e.recordBest(saved, out), saved, 'repeated extract cannot farm XP');
assert.deepEqual(e.recordBest(saved, timeout), saved, 'timeout cannot earn XP');
assert.deepEqual(e.recordBest(saved, { ...out, score: 1 }), saved, 'lower score cannot farm XP');
assert.equal(e.mastery(e.recordBest(saved, { ...out, score: 80 })).xp, 80, 'only best improvement counts');
assert.equal(e.mastery({ v: 1, best: { [`${day}:crystal:standard`]: 80 } }).title, 'Deep explorer');
assert.deepEqual(e.parseProgress(JSON.stringify(saved)), saved);
assert.throws(() => e.parseProgress('{"v":1,"best":{"bad":999}}'));
console.log('PASS mastery thresholds, persistence validation, replay prevention');
assert.equal(typeof e.acceptScore, 'function', 'incoming score boundary must exist');
const payload = { v: 1, day, id: 'peer1234', mine: 'crystal', challenge: 'standard', score: 20 };
const scores = e.acceptScore([], payload, day);
assert.equal(scores.length, 1);
assert.deepEqual(e.acceptScore(scores, payload, day), scores, 'broadcast replay deduplicated');
assert.equal(e.acceptScore(scores, { ...payload, score: 30 }, day)[0].score, 30);
for (const bad of [null, [], { ...payload, v: 2 }, { ...payload, day: '2026-10-05' }, { ...payload, score: NaN }, { ...payload, score: 289 }, { ...payload, score: -1 }, { ...payload, score: 1.5 }, { ...payload, id: 'x'.repeat(100) }, { ...payload, mine: '__proto__' }, { ...payload, challenge: 'cheat' }, { ...payload, extra: 'oversized' }]) assert.deepEqual(e.acceptScore([], bad, day), [], 'invalid broadcast rejected');
let capped = [];
for (let i = 0; i < 300; i++) capped = e.acceptScore(capped, { ...payload, id: `peer${i}` }, day);
assert.equal(capped.length, 180, 'bounded peer memory');
for (const mine of Object.keys(e.MINES)) for (const challenge of Object.keys(e.CHALLENGES)) {
  capped = e.acceptScore(capped, { ...payload, id: 'myself01', mine, challenge }, day, 'myself01');
}
assert.equal(capped.filter(p => p.id === 'myself01').length, 9, 'reserve all own mine/challenge scores after remote saturation');
assert.equal(capped.filter(p => p.id !== 'myself01').length, 180, 'remote cap remains bounded');
for (let i = 300; i < 500; i++) capped = e.acceptScore(capped, { ...payload, id: `peer${i}` }, day, 'myself01');
assert.equal(capped.length, 189, 'remote flood cannot evict own scores');
assert.deepEqual(e.acceptScore(scores, null, '2026-10-07'), [], 'UTC rollover prunes old scores');
console.log('PASS broadcast bounds, dates, version, dedupe, rollover');
for (const file of ['../src/game/expeditionStore.ts', '../src/ui/Expedition.tsx']) assert.ok(fs.existsSync(path.join(__dirname, file)), `${file}: playable persisted UI must exist`);
const read = (p) => fs.readFileSync(path.join(__dirname, '../src/', p), 'utf8');
assert.match(read('App.tsx'), /<ExpeditionPanel/);
assert.match(read('App.tsx'), /!guest && <>/, 'live guest must not see mock financial HUD');
// Modal visibility is exercised by tests/ui-browser.js, not JSX source order.
assert.match(read('ui/Modals.tsx'), /Free daily expedition/);
assert.match(read('ui/Expedition.tsx'), /setNow\(Date.now\(\)\); s.start/, 'start must refresh display clock after hidden-tab throttling');
assert.match(read('ui/ClaimPanel.tsx'), /Enter shaft expedition/);
assert.match(read('game/world.ts'), /event: 'expedition-score'/);
console.log('PASS connected free entry, shaft entry, mounted panel, realtime transport');

// Actual WebSocket I/O with the installed Supabase client. Local Phoenix relay,
// not a hosted Supabase service or server-side score verification.
async function transportCheck() {
  const { WebSocketServer, WebSocket } = require('ws');
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise((resolve) => server.on('listening', resolve));
  server.on('connection', (ws) => ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    if (msg.event === 'phx_join' || msg.event === 'heartbeat' || msg.event === 'phx_leave') {
      ws.send(JSON.stringify({ topic: msg.topic, event: 'phx_reply', payload: { status: 'ok', response: {} }, ref: msg.ref }));
    } else if (msg.event === 'broadcast') {
      for (const other of server.clients) if (other !== ws && other.readyState === WebSocket.OPEN) other.send(JSON.stringify(msg));
    }
  }));
  const loadWorld = () => {
    const m = { exports: {} };
    const code = ts.transpileModule(read('game/world.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
    const localRequire = (name) => name === './expedition' ? e : name === '../chain/chat.json' ? { url: `http://127.0.0.1:${server.address().port}`, anonKey: 'local-test-only' } : name === '../chain/lazy' ? {} : name === '../chain/light' ? {} : require(name);
    new Function('module', 'exports', 'require', code)(m, m.exports, localRequire);
    return m.exports;
  };
  const a = loadWorld(), b = loadWorld();
  const until = async (fn) => { for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise(r => setTimeout(r, 30)); } assert.fail('realtime condition timed out'); };
  try {
    a.startWorld(); b.startWorld();
    await until(() => a.useWorld.getState().status === 'online' && b.useWorld.getState().status === 'online');
    const liveDay = e.utcDay();
    a.publishExpeditionScore({ ...out, day: liveDay });
    await until(() => b.useWorld.getState().expeditionScores.length === 1);
    assert.equal(b.useWorld.getState().expeditionScores[0].score, out.score);
    a.publishExpeditionScore({ ...out, day: liveDay });
    await new Promise(r => setTimeout(r, 80));
    assert.equal(b.useWorld.getState().expeditionScores.length, 1);
    b.publishExpeditionScore({ ...out, day: liveDay, mine: 'seam' });
    await until(() => a.useWorld.getState().expeditionScores.some(p => p.mine === 'seam'));
    a.stopWorld();
    a.useWorld.setState({ expeditionScores: Array.from({ length: 180 }, (_, i) => ({ ...payload, day: liveDay, id: `peer${i}` })) });
    a.publishExpeditionScore({ ...out, day: liveDay, mine: 'tunnel' });
    assert.equal(a.useWorld.getState().expeditionDelivery, 'offline');
    assert.ok(a.useWorld.getState().expeditionScores.some(p => p.mine === 'tunnel'));
    console.log('PASS two real WebSocket clients: bidirectional score transport, dedupe, offline fallback');
  } finally {
    a.stopWorld(); b.stopWorld();
    for (const ws of server.clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
  }
}
transportCheck().catch(err => { console.error(err); process.exitCode = 1; });
