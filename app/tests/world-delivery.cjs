// Deterministic transport failures against the actual world module; SDK boundary only is stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');
const compile = file => ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/game/', file), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
}).outputText;
const rules = { exports: {} };
new Function('module', 'exports', compile('expedition.ts'))(rules, rules.exports);
const e = rules.exports;
let onStatus;
let send = async () => 'ok';
const channel = { on() { return this; }, subscribe(fn) { onStatus = fn; fn('SUBSCRIBED'); return this; }, send(p) { return p.event === 'expedition-score' ? send() : Promise.resolve('ok'); }, unsubscribe() {} };
class Client { channel() { return channel; } disconnect() {} }
function load(configured) {
  const m = { exports: {} };
  const req = name => name === './expedition' ? e : name === '../chain/chat.json' ? { url: configured ? 'http://localhost:1' : '', anonKey: configured ? 'test-only' : '' }
    : name === '@supabase/realtime-js' ? { RealtimeClient: Client } : name.startsWith('../chain/') ? {} : require(name);
  new Function('module', 'exports', 'require', compile('world.ts'))(m, m.exports, req);
  return m.exports;
}
(async () => {
  const w = load(true);
  const flush = () => new Promise(resolve => setImmediate(resolve));
  const run = { ...e.startExpedition(e.utcDay(), 'crystal', 'standard', Date.now()), status: 'extracted', score: 4 };
  try {
    w.startWorld(); await flush();
    send = async () => { throw new Error('offline'); };
    w.publishExpeditionScore(run); await flush();
    assert.equal(w.useWorld.getState().expeditionDelivery, 'failed', 'rejected send settles failed');
    send = async () => 'timed out';
    w.publishExpeditionScore(run); await flush();
    assert.equal(w.useWorld.getState().expeditionDelivery, 'failed', 'non-ok send settles failed');
    let resolve;
    send = () => new Promise(r => { resolve = r; });
    w.publishExpeditionScore(run);
    assert.equal(w.useWorld.getState().expeditionDelivery, 'sending');
    w.stopWorld();
    assert.equal(w.useWorld.getState().expeditionDelivery, 'offline', 'stop settles pending delivery');
    resolve('ok'); await flush();
    assert.equal(w.useWorld.getState().expeditionDelivery, 'offline', 'stale success cannot replace offline');
    w.startWorld(); await flush();
    onStatus('CHANNEL_ERROR');
    assert.equal(w.useWorld.getState().status, 'off', 'channel error is not perpetual connecting');
    const offline = load(false);
    offline.startWorld();
    assert.equal(offline.worldReady, false);
    assert.equal(offline.useWorld.getState().status, 'off');
    offline.publishExpeditionScore(run);
    assert.equal(offline.useWorld.getState().expeditionDelivery, 'offline');
    assert.equal(offline.useWorld.getState().expeditionScores.length, 1, 'unconfigured local play retains score');
    console.log('PASS actual world delivery: reject, non-ok, stop, stale completion, channel error, missing config');
  } finally { w.stopWorld(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
