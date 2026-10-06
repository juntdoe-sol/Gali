import assert from 'node:assert/strict';
import rpc from './functions/rpc.mjs';

const request = (body, headers = {}) => new Request('https://functions.bounded.sh/rpc', {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const message = (method, params = []) => ({ jsonrpc: '2.0', id: 1, method, params });
const ctx = { env: { HELIUS_RPC_KEY: 'test-only-not-a-credential' } };
let calls = [];
globalThis.fetch = async (url, init) => {
  calls.push({ url: new URL(url), init });
  return Response.json({ jsonrpc: '2.0', id: 1, result: 42 });
};

const denied = await rpc(request(message('sendTransaction', ['unsigned'])), ctx);
assert.equal(denied.status, 400);
assert.equal((await denied.json()).error.code, -32601);
assert.equal(calls.length, 0, 'mutations never reach the provider');
console.log('RPC deny boundary passed');

const allowed = await rpc(request(message('getSlot', [{ commitment: 'confirmed' }])), ctx);
assert.equal(allowed.status, 200);
assert.equal((await allowed.json()).result, 42);
assert.equal(calls.length, 1);
assert.equal(calls[0].url.origin, 'https://mainnet.helius-rpc.com');
assert.equal(calls[0].url.pathname, '/');
assert.equal(calls[0].url.searchParams.get('api-key'), ctx.env.HELIUS_RPC_KEY);
assert.equal(calls[0].init.redirect, 'error');
assert.deepEqual(JSON.parse(calls[0].init.body), message('getSlot', [{ commitment: 'confirmed' }]));
console.log('RPC fixed-provider read passed');

const pubkey = '11111111111111111111111111111111';
for (const [method, params] of [
  ['getBalance', [pubkey, { commitment: 'confirmed' }]],
  ['getTokenAccountBalance', [pubkey]], ['getAccountInfo', [pubkey, { encoding: 'base64' }]],
  ['getLatestBlockhash', []], ['getBlockHeight', []], ['getBlockTime', [42]],
  ['getSignatureStatuses', [['1'.repeat(64)], { searchTransactionHistory: false }]],
]) assert.equal((await rpc(request(message(method, params)), ctx)).status, 200, method);

for (const body of [null, [], [message('getSlot')], {}, message('getSlot', ['bad']),
  message('getSlot', [{ extra: 1 }]), message('getAccountInfo', ['bad']),
  message('getAccountInfo', [pubkey, { encoding: 'jsonParsed' }]),
  message('getBlockTime', [-1]), message('getSignatureStatuses', [Array(11).fill('1'.repeat(64))]),
  message('getSignatureStatuses', [['1'.repeat(64)], { searchTransactionHistory: true }]),
  message('getProgramAccounts', [pubkey]), message('requestAirdrop', [pubkey]),
  { ...message('getSlot'), upstream: 'http://127.0.0.1' },
  { ...message('getSlot'), id: null }, { ...message('getSlot'), jsonrpc: '1.0' },
]) {
  const before = calls.length;
  assert.equal((await rpc(request(body), ctx)).status, 400);
  assert.equal(calls.length, before, 'invalid request must not use upstream');
}
assert.equal((await rpc(new Request('https://example.com', { method: 'GET' }), ctx)).status, 405);
assert.equal((await rpc(request(message('getSlot'), { 'content-type': 'text/plain' }), ctx)).status, 415);
assert.equal((await rpc(request(message('getSlot'), { 'content-encoding': 'gzip' }), ctx)).status, 415);
assert.equal((await rpc(request(message('getSlot'), { 'content-length': '9000' }), ctx)).status, 413);
assert.equal((await rpc(request({ padding: 'x'.repeat(9000) }), ctx)).status, 413);
assert.equal((await rpc(new Request('https://example.com', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' }), ctx)).status, 400);
assert.equal((await rpc(request(message('getSlot')), { env: {} })).status, 503);

for (const upstream of [
  async () => { throw new Error(ctx.env.HELIUS_RPC_KEY); },
  async () => new Response('private diagnostics', { status: 401 }),
  async () => Response.json({ jsonrpc: '2.0', id: 1, error: { code: -1, message: ctx.env.HELIUS_RPC_KEY } }),
  async () => Response.json({ jsonrpc: '2.0', id: 1, result: ctx.env.HELIUS_RPC_KEY }),
  async () => Response.json({ jsonrpc: '2.0', id: 2, result: 42 }),
  async () => new Response('x'.repeat(262145)),
]) {
  globalThis.fetch = upstream;
  const response = await rpc(request(message('getSlot')), ctx);
  assert.equal(response.status, 502);
  assert.ok(!(await response.text()).includes(ctx.env.HELIUS_RPC_KEY));
}
globalThis.fetch = async () => new Response('', { status: 429 });
const limited = await rpc(request(message('getSlot')), ctx);
assert.equal(limited.status, 429);
assert.equal(limited.headers.get('retry-after'), '60');
console.log('RPC validation, bounded bodies, upstream errors, secret containment passed');
