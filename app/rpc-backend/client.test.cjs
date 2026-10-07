const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const proxy = 'https://functions.bounded.sh/apps/09310c7577ad7aa143936fb5/rpc';
const code = ts.transpileModule(fs.readFileSync('src/chain/light.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function load(network, readUrl, fail = new Map()) {
  const calls = [];
  const sandbox = { exports: {}, process: { env: { EXPO_PUBLIC_NETWORK: network, EXPO_PUBLIC_RPC_READ_URL: readUrl } },
    require: () => ({ cluster: 'devnet', programId: 'test', skrMint: '11111111111111111111111111111111' }),
    fetch: async (url) => { calls.push(url); if (fail.has(url)) return new Response('{}', { status: fail.get(url) }); return new Response('{}'); }, setTimeout, clearTimeout, AbortController, Response, URL };
  vm.runInNewContext(code, sandbox);
  return { light: sandbox.exports, calls };
}
(async () => {
  for (const [network, readUrl, expected] of [['mainnet', proxy, proxy], ['devnet', proxy, 'https://api.devnet.solana.com'], ['mainnet', undefined, 'https://api.mainnet-beta.solana.com']]) {
    const { light, calls } = load(network, readUrl);
    await light.retryingFetch(light.RPC_URL, { method: 'POST', body: JSON.stringify({ method: 'getSlot' }) });
    assert.equal(calls[0], expected);
    await light.retryingFetch(light.RPC_URL, { method: 'POST', body: JSON.stringify({ method: 'sendTransaction' }) });
    assert.equal(calls[1], expected, 'signed transactions relay through the proxy when configured (browser cannot reach the RPC)');
    await light.retryingFetch('https://unrelated.example', { method: 'POST', body: JSON.stringify({ method: 'getSlot' }) });
    assert.equal(calls[2], 'https://unrelated.example', 'do not hijack unrelated requests');
  }
  // history searches now go through the proxy too
  {
    const { light, calls } = load('mainnet', proxy);
    await light.retryingFetch(light.RPC_URL, { method: 'POST', body: JSON.stringify({ method: 'getSignatureStatuses', params: [['x'], { searchTransactionHistory: true }] }) });
    assert.equal(calls[0], proxy, 'history search uses the proxy');
    await light.retryingFetch(light.RPC_URL, { method: 'POST', body: JSON.stringify({ method: 'getSignatureStatuses', params: [['x']] }) });
    assert.equal(calls[1], proxy, 'recent status reads use the proxy');
  }
  // a rate-limited or failing proxy falls back to the direct endpoint
  for (const status of [429, 502]) {
    const { light, calls } = load('mainnet', proxy, new Map([[proxy, status]]));
    const res = await light.retryingFetch(light.RPC_URL, { method: 'POST', body: JSON.stringify({ method: 'getSlot' }) });
    assert.deepEqual(calls, [proxy, light.RPC_URL], `proxy ${status} falls back to direct`);
    assert.equal(res.status, 200);
  }
  console.log('Client read-only routing, public transaction transport, devnet isolation passed');
})().catch((e) => { console.error(e); process.exitCode = 1; });
