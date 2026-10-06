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
  getSignatureStatuses: (p) => p.length >= 1 && p.length <= 2 && Array.isArray(p[0]) &&
    p[0].length >= 1 && p[0].length <= 10 && p[0].every((s) => bytes58(s, 64)) &&
    (p[1] === undefined || (keys(p[1], ['searchTransactionHistory']) &&
      (p[1].searchTransactionHistory === undefined || p[1].searchTransactionHistory === false))),
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
  const key = ctx.env?.HELIUS_RPC_KEY;
  if (typeof key !== 'string' || !key || key.length > 256) return error(503, -32000, 'RPC unavailable', body.id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const upstream = new URL('https://mainnet.helius-rpc.com/');
    upstream.searchParams.set('api-key', key);
    const response = await fetch(upstream, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      redirect: 'manual', signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      return error(response.status === 429 ? 429 : 502, -32000, 'RPC unavailable', body.id);
    }
    const text = await boundedText(response, 262144);
    // Never relay provider diagnostics or reflected secrets, even in successful JSON.
    const result = JSON.parse(text);
    const sanitized = JSON.stringify(result);
    if (sanitized.includes(key) || sanitized.includes(encodeURIComponent(key)) || !object(result) ||
        result.jsonrpc !== '2.0' || result.id !== body.id || result.error || !Object.hasOwn(result, 'result')) {
      return error(502, -32000, 'RPC unavailable', body.id);
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result: result.result }, { headers });
  } catch { return error(502, -32000, 'RPC unavailable', body.id); }
  finally { clearTimeout(timeout); }
}
