// Gali social moments: posts ORE motherlode hits and the weekly Brawl top 3 to Gali's social
// accounts through Zernio. Called by pg_cron (see ../../sql/social-moments.sql) with a body of
//   {"job":"motherlode"}  every 2 minutes: checks the last 15 settled ORE rounds
//   {"job":"brawl"}       once a week: top 3 from the brawl_ranks view
//   {"job":"test"}        by hand: sends one test post, to check the Zernio setup
// Every post is claimed in social_moments first, so the same moment never posts twice.
// Secrets: CRON_SECRET and RPC_URL (shared with autopilot), the ZERNIO_* ones in ../_shared/zernio.ts,
// MOMENTS_OFF (optional, comma list of jobs to mute, e.g. "brawl").
import { createClient } from 'npm:@supabase/supabase-js@2';
import { PublicKey } from 'npm:@solana/web3.js@1.98.0';
import { Buffer } from 'node:buffer';
import { zernioPost } from '../_shared/zernio.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Same values as app/src/chain/ore/consts.ts and accounts.ts.
const ORE_PROGRAM = new PublicKey('oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv');
const BOARD = 'BrcSxdp1nXFzou1YyDnQJcPNBNHgoypZmTsyKBSLLXzi';
const DISC = 8;
const ROUND_SIZE = DISC + 944;
const ONE_ORE = 100_000_000_000n;
const LOOKBACK = 15n;

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(Deno.env.get('RPC_URL')!, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
const bytes = (b64: string) => Buffer.from(b64, 'base64');
const roundPda = (id: bigint) => {
  const n = Buffer.alloc(8);
  n.writeBigUInt64LE(id);
  return PublicKey.findProgramAddressSync([Buffer.from('round'), n], ORE_PROGRAM)[0].toBase58();
};
const ore = (grams: bigint) => `${grams / ONE_ORE}.${((grams % ONE_ORE) * 100n / ONE_ORE).toString().padStart(2, '0')}`;

/** Claims the key, then posts. Returns null when this moment was already handled. */
async function post(key: string, kind: string, content: string) {
  const { error } = await db.from('social_moments').insert({ key, kind, content });
  if (error) {
    if (error.code === '23505') return null;
    throw new Error(error.message);
  }
  const r = await zernioPost(content);
  await db.from('social_moments').update({ status: !r.ok ? 'failed' : r.live ? 'posted' : 'draft', zernio_id: r.id, error: r.error }).eq('key', key);
  return { key, ...r };
}

async function motherlode() {
  const board = await rpc('getAccountInfo', [BOARD, { encoding: 'base64' }]);
  const current = bytes(board.value.data[0]).readBigUInt64LE(DISC);
  const ids: bigint[] = [];
  for (let i = 1n; i <= LOOKBACK && current - i >= 0n; i++) ids.push(current - i);
  const res = await rpc('getMultipleAccounts', [ids.map(roundPda), { encoding: 'base64' }]);
  const out = [];
  for (const acc of res.value) {
    if (!acc) continue; // closed by ORE
    const d = bytes(acc.data[0]);
    if (d.length !== ROUND_SIZE) continue;
    if (d.subarray(DISC + 608, DISC + 640).every((b) => b === 0)) continue; // not settled yet
    const paid = d.readBigUInt64LE(DISC + 648);
    if (paid === 0n) continue;
    const id = d.readBigUInt64LE(DISC);
    const content = `Motherlode hit on the ORE board. ${ore(paid)} ORE paid out in round #${id}.\n\nWho is mining the next one?`;
    const r = await post(`motherlode:${id}`, 'motherlode', content);
    if (r) out.push(r);
  }
  return out;
}

async function brawl() {
  const { data, error } = await db.from('brawl_ranks').select('name, kos, wins, points').order('points', { ascending: false }).limit(3);
  if (error) throw new Error(error.message);
  if (!data?.length) return [];
  const lines = data.map((p, i) => `${i + 1}. ${p.name}: ${p.points} pts (${p.kos} KOs, ${p.wins} arena wins)`);
  const content = `Gali Brawl top 3, last 7 days:\n\n${lines.join('\n')}\n\nKOs and arena wins both count.`;
  const r = await post(`brawl:${new Date().toISOString().slice(0, 10)}`, 'brawl', content);
  return r ? [r] : [];
}

async function test() {
  const r = await post(`test:${Date.now()}`, 'test', 'Gali social posting test. Ignore this one.');
  return r ? [r] : [];
}

const JOBS: Record<string, () => Promise<unknown[]>> = { motherlode, brawl, test };

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) return json(401, { error: 'not allowed' });
  const { job = 'motherlode' } = await req.json().catch(() => ({}));
  const run = JOBS[job];
  if (!run) return json(400, { error: `unknown job ${job}` });
  const off = (Deno.env.get('MOMENTS_OFF') ?? '').split(',').map((s) => s.trim());
  if (off.includes(job)) return json(200, { job, muted: true });
  try {
    const posted = await run();
    const report = { job, posted };
    console.log(JSON.stringify(report));
    return json(200, report);
  } catch (e) {
    console.error(job, e);
    return json(500, { job, error: String(e) });
  }
});
