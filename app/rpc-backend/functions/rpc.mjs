// Public read-only route. Bounded public ingress supplies 120 requests/minute
// per app+function per Cloudflare location. Do not host without an edge limiter.
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const error = (status, code, message, id = null) => Response.json({ jsonrpc: '2.0', id, error: { code, message } }, {
  status, headers: { ...headers, ...(status === 429 ? { 'retry-after': '60' } : {}) },
});
const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const uint = (v) => Number.isSafeInteger(v) && v >= 0;
const keys = (v, allowed) => object(v) && Object.keys(v).every((key) => allowed.includes(key));
const base58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const bytes58 = (value, size) => {
  if (typeof value !== 'string' || value.length < size || value.length > Math.ceil(size * 1.38)) return false;
  let n = 0n;
  for (const c of value) {
    const digit = base58.indexOf(c);
    if (digit < 0) return false;
    n = n * 58n + BigInt(digit);
  }
  let bytes = 0;
  while (n) { bytes++; n >>= 8n; }
  return bytes + (value.match(/^1*/)[0].length) === size;
};
const config = (value, account = false) => value === undefined || (
  keys(value, account ? ['commitment', 'minContextSlot', 'encoding'] : ['commitment', 'minContextSlot']) &&
  (value.commitment === undefined || ['processed', 'confirmed', 'finalized'].includes(value.commitment)) &&
  (value.minContextSlot === undefined || uint(value.minContextSlot)) &&
  (!account || value.encoding === undefined || value.encoding === 'base64')
);
const validators = {
  getSlot: (p) => p.length <= 1 && config(p[0]),
  getBlockHeight: (p) => p.length <= 1 && config(p[0]),
  getLatestBlockhash: (p) => p.length <= 1 && config(p[0]),
  getBlockTime: (p) => p.length === 1 && uint(p[0]),
  getBalance: (p) => p.length >= 1 && p.length <= 2 && bytes58(p[0], 32) && config(p[1]),
  getTokenAccountBalance: (p) => p.length >= 1 && p.length <= 2 && bytes58(p[0], 32) && config(p[1]),
  getAccountInfo: (p) => p.length >= 1 && p.length <= 2 && bytes58(p[0], 32) && config(p[1], true),
  getMultipleAccounts: (p) => p.length >= 1 && p.length <= 2 && Array.isArray(p[0]) && p[0].length >= 1 && p[0].length <= 20 &&
    p[0].every((k) => bytes58(k, 32)) && config(p[1], true),
  getSignatureStatuses: (p) => p.length >= 1 && p.length <= 2 && Array.isArray(p[0]) &&
    p[0].length >= 1 && p[0].length <= 10 && p[0].every((s) => bytes58(s, 64)) &&
    (p[1] === undefined || (keys(p[1], ['searchTransactionHistory']) &&
      (p[1].searchTransactionHistory === undefined || typeof p[1].searchTransactionHistory === 'boolean'))),
  // Relays one already-signed transaction (the browser cannot reach the RPC directly). The wallet holds
  // the keys; this only forwards bytes. Strict shape: base64, at most 1232 bytes (1644 chars), fixed options.
  sendTransaction: (p) => p.length === 2 && typeof p[0] === 'string' && p[0].length >= 100 && p[0].length <= 1644 &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(p[0]) && keys(p[1], ['encoding', 'skipPreflight', 'preflightCommitment', 'maxRetries']) &&
    p[1].encoding === 'base64' &&
    (p[1].skipPreflight === undefined || typeof p[1].skipPreflight === 'boolean') &&
    (p[1].preflightCommitment === undefined || ['processed', 'confirmed', 'finalized'].includes(p[1].preflightCommitment)) &&
    (p[1].maxRetries === undefined || (uint(p[1].maxRetries) && p[1].maxRetries <= 5)),
};

async function boundedText(message, limit) {
  if (Number(message.headers.get('content-length')) > limit) throw new RangeError('body too large');
  if (!message.body) return '';
  const reader = message.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new RangeError('body too large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export default async function rpc(req, ctx) {
  if (req.method !== 'POST') return error(405, -32600, 'POST required');
  if (req.headers.get('content-encoding') || !/^application\/json(?:\s*;|$)/i.test(req.headers.get('content-type') || '')) {
    return error(415, -32600, 'JSON required');
  }
  let body;
  try { body = JSON.parse(await boundedText(req, 8192)); }
  catch (e) { return error(e instanceof RangeError ? 413 : 400, -32700, 'Invalid request body'); }
  // ponytail: no batches or notifications; add only with aggregate quota accounting.
  if (!keys(body, ['jsonrpc', 'id', 'method', 'params']) || body.jsonrpc !== '2.0' ||
      !(uint(body.id) || (typeof body.id === 'string' && body.id.length > 0 && body.id.length <= 64)) ||
      typeof body.method !== 'string' || !Array.isArray(body.params)) {
    return error(400, -32600, 'Invalid request');
  }
  if (!Object.hasOwn(validators, body.method)) return error(400, -32601, 'Method not allowed', body.id);
  if (!validators[body.method](body.params)) return error(400, -32602, 'Invalid params', body.id);
  // Short shared cache for read calls: every player watches the same round, so identical reads are answered
  // once per few seconds. Transaction status and sendTransaction are never cached.
  const ttl = CACHE_MS[body.method];
  if (!ttl) return forward(body, ctx);
  const key = body.method + JSON.stringify(body.params);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.until > now) return Response.json({ jsonrpc: '2.0', id: body.id, result: hit.result }, { headers });
  let flight = inflight.get(key);
  if (!flight) {
    flight = (async () => {
      const response = await forward({ ...body, id: 1 }, ctx);
      if (!response.ok) return { response };
      const parsed = await response.json();
      if (!object(parsed) || !Object.hasOwn(parsed, 'result')) return { response };
      if (cache.size >= 300) cache.delete(cache.keys().next().value);
      cache.set(key, { until: Date.now() + ttl, result: parsed.result });
      return { result: parsed.result };
    })().finally(() => inflight.delete(key));
    inflight.set(key, flight);
  }
  const out = await flight;
  if (out.response) return error(out.response.status, -32000, 'RPC unavailable', body.id);
  return Response.json({ jsonrpc: '2.0', id: body.id, result: out.result }, { headers });
}

const CACHE_MS = {
  getSlot: 1500, getBlockHeight: 1500, getLatestBlockhash: 2000, getBlockTime: 60000,
  getAccountInfo: 2000, getMultipleAccounts: 2000, getBalance: 1500, getTokenAccountBalance: 1500,
};
const cache = new Map();
const inflight = new Map();

async function forward(body, ctx) {
  // Helius first, Alchemy as the second path. Each key lives only in the function's secrets.
  const providers = [];
  const hk = ctx.env?.HELIUS_RPC_KEY;
  if (typeof hk === 'string' && hk && hk.length <= 256) {
    providers.push({ key: hk, url: () => { const u = new URL('https://mainnet.helius-rpc.com/'); u.searchParams.set('api-key', hk); return u; } });
  }
  const ak = ctx.env?.ALCHEMY_RPC_KEY;
  if (typeof ak === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(ak)) {
    providers.push({ key: ak, url: () => new URL(`https://solana-mainnet.g.alchemy.com/v2/${ak}`) });
  }
  if (!providers.length) return error(503, -32000, 'RPC unavailable', body.id);
  let status = 502;
  for (const [i, p] of providers.entries()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providers.length > 1 && i === 0 ? 4500 : 8000);
    try {
      const response = await fetch(p.url(), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        redirect: 'manual', signal: controller.signal,
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429) status = 429;
        continue;
      }
      const text = await boundedText(response, 262144);
      // Never relay provider diagnostics or reflected secrets, even in successful JSON.
      const result = JSON.parse(text);
      const sanitized = JSON.stringify(result);
      if (sanitized.includes(p.key) || sanitized.includes(encodeURIComponent(p.key)) || !object(result) ||
          result.jsonrpc !== '2.0' || result.id !== body.id) {
        continue;
      }
      // A node refusing a transaction (simulation failed) is an answer, not an outage: pass the reason on so the app can say why.
      if (body.method === 'sendTransaction' && object(result.error) && typeof result.error.message === 'string') {
        const code = Number.isInteger(result.error.code) ? result.error.code : -32002;
        return Response.json({ jsonrpc: '2.0', id: body.id, error: { code, message: result.error.message.slice(0, 600) } }, { headers });
      }
      if (result.error || !Object.hasOwn(result, 'result')) continue;
      return Response.json({ jsonrpc: '2.0', id: body.id, result: result.result }, { headers });
    } catch { /* this provider failed: try the next */ }
    finally { clearTimeout(timeout); }
  }
  return error(status, -32000, 'RPC unavailable', body.id);
}
