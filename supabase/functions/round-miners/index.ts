// The current ORE round's miners, for the BOT tab's CURRENT ROUND card: every wallet that deployed this round, with
// its SOL in all and per spot, biggest first. Anyone can read it (it is all public on chain); one ORE read per few
// seconds per instance, however many players ask. Secret: RPC_URL (mainnet RPC with getProgramAccounts).
// Names come from gali_miners when a miner has one on Gali.
const ORE_PROGRAM = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
const BOARD = 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi';
const MINER_SIZE = 8 + 744;
const CACHE_MS = 5_000;
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'public, max-age=4' } });

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  let s = '';
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = '1' + s;
  }
  return s;
}
const u64 = (d: Uint8Array, o: number) => {
  let v = 0n;
  for (let k = 7; k >= 0; k--) v = (v << 8n) | BigInt(d[o + k]);
  return v;
};
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

export interface RoundMiner { wallet: string; name: string | null; sol: number; spots: number; perSpot: number; squares: number[] }
let cached: { at: number; body: unknown } | null = null;

async function call(rpc: string, method: string, params: unknown[]) {
  const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message ?? 'error'}`);
  return j.result;
}

async function load(rpc: string, base: string | undefined, key: string | undefined) {
  const [board, slot] = await Promise.all([call(rpc, 'getAccountInfo', [BOARD, { encoding: 'base64', commitment: 'confirmed' }]), call(rpc, 'getSlot', [{ commitment: 'confirmed' }])]);
  const bd = fromB64(board.value.data[0]);
  const roundId = u64(bd, 8);
  const endSlot = u64(bd, 8 + 16);
  const id = new Uint8Array(8);
  new DataView(id.buffer).setBigUint64(0, roundId, true);
  const accounts: { account: { data: [string, string] } }[] = await call(rpc, 'getProgramAccounts', [
    ORE_PROGRAM,
    { encoding: 'base64', commitment: 'confirmed', filters: [{ dataSize: MINER_SIZE }, { memcmp: { offset: 8 + 656, bytes: toB64(id), encoding: 'base64' } }], dataSlice: { offset: 8, length: 256 } },
  ]);
  const miners: RoundMiner[] = [];
  for (const a of accounts) {
    const d = fromB64(a.account.data[0]);
    if (d.length < 256) continue;
    const per = Array.from({ length: 25 }, (_, i) => Number(u64(d, 56 + i * 8)));
    const total = per.reduce((x, y) => x + y, 0);
    if (total <= 0) continue;
    const squares = per.flatMap((v, i) => (v > 0 ? [i] : []));
    miners.push({ wallet: b58(d.subarray(0, 32)), name: null, sol: total / 1e9, spots: squares.length, perSpot: total / squares.length / 1e9, squares });
  }
  miners.sort((x, y) => y.sol - x.sol);
  // Gali names, when a miner has one
  if (base && key && miners.length) {
    const list = miners.slice(0, 300).map((m) => `"${m.wallet}"`).join(',');
    const r = await fetch(`${base}/rest/v1/gali_miners?select=wallet,name&wallet=in.(${encodeURIComponent(list)})`, { headers: { apikey: key, authorization: `Bearer ${key}` } }).catch(() => null);
    const rows: { wallet: string; name: string | null }[] = r && r.ok ? await r.json() : [];
    const names = new Map(rows.map((x) => [x.wallet, x.name]));
    for (const m of miners) m.name = names.get(m.wallet) ?? null;
  }
  const slotsLeft = Math.max(0, Number(endSlot) - Number(slot));
  return { round: roundId.toString(), slotsLeft, miners: miners.length, sol: miners.reduce((x, m) => x + m.sol, 0), list: miners.slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const rpc = Deno.env.get('RPC_URL');
  if (!rpc) return json(500, { error: 'server is not set up' });
  if (cached && Date.now() - cached.at < CACHE_MS) return json(200, cached.body);
  try {
    const body = await load(rpc, Deno.env.get('SUPABASE_URL'), Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
    cached = { at: Date.now(), body };
    return json(200, body);
  } catch (e) {
    return json(502, { error: String((e as Error)?.message ?? e).slice(0, 160) });
  }
});
