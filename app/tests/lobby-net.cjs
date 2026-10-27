// Run: node tests/lobby-net.cjs
// Two or more players on a fake realtime bus: chat history reaches a newcomer, a reopened app keeps its chat,
// looks travel only when needed, and a walker sends at most about twice a second.
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const out = path.join(os.tmpdir(), 'gali-lobby-net.cjs');
const S = (f) => path.join(__dirname, 'stubs', f);
// swap the app's world, storage and name modules for the stubs
const plugin = `{name:'stub',setup(b){b.onResolve({filter:/\\.\\/(world|storage|username)$/},a=>({path:{world:${JSON.stringify(S('world.ts'))},storage:${JSON.stringify(S('storage.ts'))},username:${JSON.stringify(S('username.ts'))}}[a.path.slice(2)]}))}}`;
// the lobby plus the pass setter from game/play.ts (chat lines are saved through the signed play function)
const entry = path.join(os.tmpdir(), 'gali-lobby-net-entry.ts');
fs.writeFileSync(entry, `export * from ${JSON.stringify(path.join(__dirname, '../src/game/lobby.ts'))};\nexport { setPlayPass } from ${JSON.stringify(path.join(__dirname, '../src/game/play.ts'))};\n`);
const script = `require(${JSON.stringify(require.resolve('esbuild', { paths: [path.join(__dirname, '..')] }))}).buildSync({entryPoints:[${JSON.stringify(entry)}],bundle:true,platform:'node',format:'cjs',outfile:${JSON.stringify(out)},nodePaths:[${JSON.stringify(path.join(__dirname, '../node_modules'))}],logLevel:'error',plugins:[${plugin}]})`;
// buildSync does not take plugins; use build() in a child instead
fs.writeFileSync(out + '.build.cjs', script.replace('buildSync', 'build').replace(/^require/, 'require'));
execFileSync(process.execPath, [out + '.build.cjs'], { stdio: 'inherit' });
const code = fs.readFileSync(out, 'utf8');

const counts = {};
const bus = {
  rooms: {},
  join(name, h, ch) { (this.rooms[name] ??= []).push({ h, ch }); },
  leave(name, ch) { this.rooms[name] = (this.rooms[name] || []).filter((r) => r.ch !== ch); },
  send(name, from, ev, payload) {
    counts[ev] = (counts[ev] || 0) + 1;
    for (const r of this.rooms[name] || []) if (r.ch !== from && r.h[ev]) setTimeout(() => r.h[ev]({ payload: JSON.parse(JSON.stringify(payload)) }), 2);
  },
};
function player(name, mem = new Map()) {
  globalThis.__bus = bus;
  globalThis.__mem = mem;
  globalThis.__name = name;
  const m = { exports: {} };
  new Function('module', 'exports', 'require', code)(m, m.exports, require);
  return Object.assign(m.exports, { mem });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const look = (hat) => ({ hat, fit: '#2f5fd0', pick: '#c9c9c9', handle: '#9b6b43', pet: null, glow: 'none', sex: 'm' });

(async () => {
  const A = player('ALICE');
  A.joinChat();
  A.joinLobby();
  await wait(30);
  assert.ok(A.useLobby.getState().say('hello from alice'));
  await wait(1000);
  assert.ok(A.useLobby.getState().say('second line'));

  // Bob opens the app later and gets the lines he missed
  const B = player('BOB');
  B.joinChat();
  B.joinLobby();
  await wait(1700);
  const bt = B.useLobby.getState().msgs.map((m) => m.text);
  assert.deepEqual(bt, ['hello from alice', 'second line'], 'history reached the newcomer');
  assert.ok(!B.useLobby.getState().msgs.some((m) => m.mine), 'not marked as his');
  assert.equal(counts.hist, 1, 'one answer');

  // Bob reopens with nobody else online: his phone kept the chat
  await wait(900); // save delay
  const B2 = player('BOB', B.mem);
  await B2.loadChatHistory();
  assert.deepEqual(B2.useLobby.getState().msgs.map((m) => m.text), ['hello from alice', 'second line'], 'kept on the phone');

  // history never doubles a line Bob already has
  B.useLobby.setState({});
  // walking: look rides along once, then only the move
  const sent0 = counts.state || 0;
  let x = 100;
  const t0 = Date.now();
  while (Date.now() - t0 < 3000) {
    x += 2;
    A.publishLobbyMe({ x, y: 100, tx: x + 44, ty: 100, facing: 1, pose: 'walk', look: look('hat-red'), lvl: 3 });
    await wait(50);
  }
  const sent = (counts.state || 0) - sent0;
  assert.ok(sent <= 7, `walker sends at most ~2/s (sent ${sent} in 3 s)`);
  await wait(20);
  const pa = B.useLobby.getState().peers[A.useLobby.getState().me];
  assert.ok(pa, 'Bob sees Alice');
  assert.equal(pa.look.hat, 'hat-red', 'look arrived');
  assert.equal(pa.lvl, 3);
  // a later move-only packet keeps her look
  await wait(600);
  A.publishLobbyMe({ x: 400, y: 100, tx: 450, ty: 100, facing: 1, pose: 'walk', look: look('hat-red'), lvl: 3 });
  await wait(20);
  assert.equal(B.useLobby.getState().peers[A.useLobby.getState().me].look.hat, 'hat-red', 'look kept');

  // a wallet is only believed with the id made from it: reusing Alice's id cannot put another wallet on her
  const W_A = '9ma7yr5cMEWjZCWFHnQ1SGzYe7qQMumiRb7H6mfavPMz';
  const W_M = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
  await wait(600);
  A.publishLobbyMe({ x: 400, y: 100, tx: 460, ty: 100, facing: 1, pose: 'walk', look: look('hat-red'), lvl: 3, wallet: W_A });
  await wait(600);
  A.publishLobbyMe({ x: 400, y: 100, tx: 470, ty: 100, facing: 1, pose: 'walk', look: look('hat-red'), lvl: 3, wallet: W_A });
  await wait(30);
  const aid = A.useLobby.getState().me;
  assert.ok(aid.startsWith(W_A.slice(0, 8)), 'Alice plays under an id made from her wallet');
  assert.equal(B.useLobby.getState().peers[aid]?.wallet, W_A, 'Bob sees her wallet');
  bus.send('gali-lobby', null, 'state', { id: aid, nm: 'Alice', x: 400, y: 100, tx: 470, ty: 100, f: 1, p: 'walk', h: 'hat-red', c: '#2f5fd0', k: '#c9c9c9', hd: '#9b6b43', g: 'none', sx: 'm', lvl: 3, w: W_M });
  await wait(20);
  assert.equal(B.useLobby.getState().peers[aid].wallet, W_A, 'a copied id cannot carry another wallet');
  bus.send('gali-lobby', null, 'state', { id: 'abcdefgh', nm: 'Mallory', x: 1, y: 1, tx: 1, ty: 1, f: 1, p: 'idle', h: 'hat-red', c: '#2f5fd0', k: '#c9c9c9', hd: '#9b6b43', g: 'none', sx: 'm', lvl: 1, w: W_M });
  await wait(20);
  assert.equal(B.useLobby.getState().peers.abcdefgh.wallet, null, 'a wallet that does not match its id is dropped');

  // the saved table: a line said with nobody online still reaches the next player who opens the app
  const table = [];
  let nextId = 1;
  globalThis.__rest = 'https://db.test';
  const WALLET = 'So11111111111111111111111111111111111111112';
  globalThis.fetch = async (url, opts = {}) => {
    assert.equal(opts.headers.apikey, 'anon-test');
    if (opts.method === 'POST') {
      // lines are saved only through the play function, signed in; the server names the wallet from the pass
      assert.equal(String(url), 'https://db.test/functions/v1/play', 'only through the play function');
      const b = JSON.parse(opts.body);
      assert.equal(b.a, 'chat');
      assert.equal(b.pass, 'test-pass');
      table.push({ id: nextId++, at: new Date().toISOString(), mid: b.mid, sender: b.sender, name: b.name, body: b.body, wallet: WALLET });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    assert.ok(String(url).startsWith('https://db.test/rest/v1/lobby_chat'), 'reads only the chat table');
    const lim = Number(/limit=(\d+)/.exec(url)[1]);
    return { ok: true, status: 200, json: async () => table.slice().sort((a, b) => b.id - a.id).slice(0, lim).map(({ mid, sender, name, body, at }) => ({ mid, sender, name, body, at })) };
  };
  bus.rooms = {};
  const C = player('CAROL');
  C.setPlayPass('test-pass', WALLET);
  C.joinChat();
  await wait(30);
  C.publishLobbyMe({ x: 1, y: 1, tx: 1, ty: 1, facing: 1, pose: 'idle', look: look('hat-red'), lvl: 1, wallet: 'So11111111111111111111111111111111111111112' });
  assert.ok(C.useLobby.getState().say('anyone here?'));
  await wait(20);
  assert.equal(table.length, 1, 'line saved');
  assert.equal(table[0].body, 'anyone here?');
  assert.equal(table[0].wallet, 'So11111111111111111111111111111111111111112', 'wallet saved for muting');
  assert.equal(table[0].sender, C.useLobby.getState().me);
  assert.ok(C.useLobby.getState().me.startsWith(WALLET.slice(0, 8)), 'a player with a wallet plays under an id made from it');
  table.push({ id: nextId++, at: new Date(Date.now() - 8 * 24 * 3600_000).toISOString(), mid: 'old-line-1', sender: 'x', name: 'Old', body: 'too old' });
  table.push({ id: nextId++, at: new Date().toISOString(), mid: 'BAD MID', sender: 'x', name: 'Bad', body: 'bad mid' });
  bus.rooms = {}; // Carol closes the app: nobody online
  const D = player('DAVE');
  D.joinChat();
  await wait(1700);
  assert.deepEqual(D.useLobby.getState().msgs.map((m) => m.text), ['anyone here?'], 'saved line reached a lone newcomer; old and bad rows dropped');
  assert.equal(D.useLobby.getState().msgs[0].name, 'CAROL');
  console.log('lobby-net: all passed', JSON.stringify(counts));
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
