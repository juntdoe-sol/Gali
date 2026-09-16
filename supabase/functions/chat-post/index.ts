// Gali miners chat: accepts a message only if it is signed by the sender's active
// on-chain session key (Player.session in the Gali program), then stores it.
// Tip messages must reference a confirmed SKR transfer from the sender to the recipient.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js';
import bs58 from 'npm:bs58@6';

const RPC = Deno.env.get('SOLANA_RPC') ?? 'https://api.devnet.solana.com';
const PROGRAM_ID = Deno.env.get('GALI_PROGRAM_ID') ?? 'GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV';
const SKR_MINT = Deno.env.get('SKR_MINT') ?? '';
const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// PDA: sha256(seeds.. || program_id || "ProgramDerivedAddress"), first bump that is off-curve
async function playerPda(owner: Uint8Array) {
  const pid = bs58.decode(PROGRAM_ID);
  for (let bump = 255; bump >= 0; bump--) {
    const buf = new Uint8Array([...new TextEncoder().encode('player'), ...owner, bump, ...pid, ...new TextEncoder().encode('ProgramDerivedAddress')]);
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    try {
      ed25519.Point.fromBytes(h);
    } catch {
      return bs58.encode(h);
    }
  }
  throw new Error('no PDA');
}

// Player layout (Anchor/Borsh): disc 8 | owner 32 | points 8 | xp 8 | wins 4 | rounds 4 | day 4 |
// streak 2 | staked_skr 8 | gear_mask 4 | session 32 | session_expires 8 ...
async function readPlayer(owner: string) {
  const info = await rpc('getAccountInfo', [await playerPda(bs58.decode(owner)), { encoding: 'base64' }]);
  if (!info.value || info.value.owner !== PROGRAM_ID) return null;
  const b = Uint8Array.from(atob(info.value.data[0]), (c) => c.charCodeAt(0));
  const v = new DataView(b.buffer);
  const xp = Number(v.getBigUint64(48, true));
  let level = 1;
  while (xp >= (100 * level * (level + 1)) / 2) level++;
  return { session: bs58.encode(b.slice(82, 114)), expires: Number(v.getBigInt64(114, true)), level };
}

async function tipIsReal(sig: string, from: string, to: string, amount: number) {
  const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx || tx.meta?.err) return false;
  const signer = tx.transaction.message.accountKeys.find((k: { signer: boolean }) => k.signer)?.pubkey;
  if (signer !== from) return false;
  const bal = (list: { owner: string; mint: string; uiTokenAmount: { uiAmount: number | null } }[]) =>
    list.filter((x) => x.owner === to && (!SKR_MINT || x.mint === SKR_MINT)).reduce((s, x) => s + (x.uiTokenAmount.uiAmount ?? 0), 0);
  const gained = bal(tx.meta.postTokenBalances ?? []) - bal(tx.meta.preTokenBalances ?? []);
  return gained + 1e-9 >= amount;
}

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const { wallet, session, body, ts, sig, room = 'global', tip } = await req.json();
    const text = String(body ?? '').trim().slice(0, 280);
    if (!wallet || !session || !sig || !text) return reply(400, { error: 'missing fields' });
    if (Math.abs(Date.now() - Number(ts)) > 60_000) return reply(400, { error: 'stale message' });

    const msg = new TextEncoder().encode(`gali-chat:${room}:${wallet}:${ts}:${text}`);
    const sigBytes = Uint8Array.from(atob(String(sig)), (c) => c.charCodeAt(0));
    if (!ed25519.verify(sigBytes, msg, bs58.decode(session))) return reply(401, { error: 'bad signature' });

    const player = await readPlayer(wallet);
    if (!player) return reply(403, { error: 'play one round on-chain to join the chat' });
    if (player.session !== session || player.expires * 1000 < Date.now()) return reply(403, { error: 'session expired; start a new one' });

    const { data: last } = await db.from('messages').select('created_at').eq('wallet', wallet).order('created_at', { ascending: false }).limit(1);
    if (!tip && last?.[0] && Date.now() - new Date(last[0].created_at).getTime() < 2000) return reply(429, { error: 'slow down' });

    const row: Record<string, unknown> = { room, wallet, name: short(wallet), level: player.level, body: text, kind: 'msg' };
    if (tip) {
      const amount = Number(tip.amount);
      if (!tip.to || !tip.sig || !(amount > 0)) return reply(400, { error: 'bad tip' });
      if (!(await tipIsReal(tip.sig, wallet, tip.to, amount))) return reply(400, { error: 'tip transaction not found' });
      Object.assign(row, { kind: 'tip', tip_to: tip.to, tip_amount: amount, tip_sig: tip.sig });
    }
    const { data, error } = await db.from('messages').insert(row).select().single();
    if (error) return reply(400, { error: error.message });
    return reply(200, data);
  } catch (e) {
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
