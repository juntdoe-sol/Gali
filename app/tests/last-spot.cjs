// Run: node tests/last-spot.cjs
// Web: after a refresh the miner opens on the same screen and lobby spot; stale or broken saves are ignored.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const src = fs.readFileSync(path.join(__dirname, '../src/game/lastSpot.ts'), 'utf8');
const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;

function page(stored) {
  const store = new Map(stored === undefined ? [] : [['gali-last-spot', stored]]);
  const listeners = {};
  globalThis.window = { addEventListener: (k, f) => (listeners[k] = f) };
  globalThis.document = {};
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  return { api: m.exports, store, hide: () => listeners.pagehide?.() };
}

(async () => {
  // first visit: lobby start
  let p = page();
  assert.equal(p.api.bootWhere(), 'lobby');
  assert.equal(p.api.takeBootSpot(), null);

  // walk, then the page goes: the spot is written
  p.api.saveLobbySpot(812.4, 455.6);
  p.hide();
  const saved = p.store.get('gali-last-spot');
  assert.deepEqual({ ...JSON.parse(saved), at: 0 }, { where: 'lobby', x: 812, y: 456, at: 0 });

  // refresh: same spot, once
  p = page(saved);
  assert.equal(p.api.bootWhere(), 'lobby');
  assert.deepEqual(p.api.takeBootSpot(), { x: 812, y: 456 });
  assert.equal(p.api.takeBootSpot(), null, 'only the first lobby visit after a refresh');

  // went to the island: a refresh opens the island, and the lobby spot is kept for later
  p.api.saveWhere('island');
  await new Promise((r) => setTimeout(r, 1100));
  p = page(p.store.get('gali-last-spot'));
  assert.equal(p.api.bootWhere(), 'island');
  assert.equal(p.api.takeBootSpot(), null);

  // stale (over 12 hours) and broken saves start fresh
  p = page(JSON.stringify({ where: 'island', x: 1, y: 1, at: Date.now() - 13 * 3600_000 }));
  assert.equal(p.api.bootWhere(), 'lobby');
  p = page('{not json');
  assert.equal(p.api.bootWhere(), 'lobby');
  p = page(JSON.stringify({ where: 'moon', at: Date.now() }));
  assert.equal(p.api.bootWhere(), 'lobby');

  // the phone app (no document): nothing read or saved
  delete globalThis.document;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  m.exports.saveLobbySpot(5, 5);
  assert.equal(m.exports.bootWhere(), 'lobby');
  console.log('last spot passed');
  process.exit(0);
})();
