// Real PixelMine bridge functions, with only platform/rendering dependencies stubbed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
let state = { wallet: { owner: null } };
const peer = { id: 'remote01', x: 0, y: 0, tx: 40, ty: 40, pose: 'walk' };
const world = { status: 'off', peers: { remote01: peer } };
let bots = 0, thoughts = 0, cleared = 0;
const constants = { GEAR: [], BLOCKS: 25 };
const load = name => name === '../chain/light' ? { oreLive: true }
  : name === '../game/store' ? { useGame: { getState: () => state }, isOnChain: s => Boolean(s.wallet.owner) }
  : name === '../game/world' ? { useWorld: { getState: () => world }, ensureBots: () => bots++, thinkBots: () => thoughts++, clearBots: () => cleared++ }
  : name === '../game/constants' ? constants
  : name === '../engine/island' ? { CLAIMS: [{ stand: [0, 0] }] }
  : name === 'react-native' ? { StyleSheet: { create: x => x } } : {};
const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../src/pixel/PixelMine.tsx'), 'utf8') + '\nexport { stepPeers };', {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
}).outputText;
const m = { exports: {} };
new Function('require', 'module', 'exports', code)(load, m, m.exports);
m.exports.stepPeers(0.1);
assert.equal(bots, 0, 'mainnet guest cannot create practice bots');
assert.equal(thoughts, 0, 'mainnet guest cannot think practice bots');
assert.equal(peer.x, 0, 'mainnet guest pauses peer interpolation');
assert.equal(cleared, 1, 'disconnect clears existing practice bots');
state.wallet.owner = 'connected-fixture';
m.exports.stepPeers(0.1);
assert.ok(peer.x > 0, 'connected peer interpolation remains active');
assert.equal(bots, 0, 'mainnet connected players cannot create practice bots');
console.log('PASS actual PixelMine stepPeers: guest simulation paused, bots cleared, connected movement retained');
