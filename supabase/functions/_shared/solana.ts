// Small Solana helpers shared by the chat functions (no web3.js, to keep cold starts fast).
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js';
import bs58 from 'npm:bs58@6';

export const RPC = Deno.env.get('SOLANA_RPC') ?? 'https://api.devnet.solana.com';
export const PROGRAM_ID = Deno.env.get('GALI_PROGRAM_ID') ?? 'GamTh2wWNNGU6CB5G3aF7Xeu1m7fQEtd9caRGtgPcMmV';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
export const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

export async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

// PDA: sha256(seeds || bump || program_id || "ProgramDerivedAddress"), first bump that is off-curve
export async function pda(seeds: Uint8Array[]) {
  const pid = bs58.decode(PROGRAM_ID);
  const tail = new TextEncoder().encode('ProgramDerivedAddress');
  for (let bump = 255; bump >= 0; bump--) {
    const parts = [...seeds.flatMap((s) => [...s]), bump, ...pid, ...tail];
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(parts)));
    try {
      ed25519.Point.fromBytes(h);
    } catch {
      return bs58.encode(h);
    }
  }
  throw new Error('no PDA');
}

export async function accountData(address: string) {
  const info = await rpc('getAccountInfo', [address, { encoding: 'base64' }]);
  if (!info.value || info.value.owner !== PROGRAM_ID) return null;
  return Uint8Array.from(atob(info.value.data[0]), (c) => c.charCodeAt(0));
}

/** Config layout: disc 8 | authority 32 | ... */
export async function configAuthority() {
  const b = await accountData(await pda([new TextEncoder().encode('config')]));
  if (!b) throw new Error('config not found');
  return bs58.encode(b.slice(8, 40));
}

// Player layout (Anchor/Borsh): disc 8 | owner 32 | points 8 | xp 8 | wins 4 | rounds 4 | day 4 |
// streak 2 | staked_skr 8 | gear_mask 4 | session 32 | session_expires 8 ...
export async function readPlayer(owner: string) {
  const b = await accountData(await pda([new TextEncoder().encode('player'), bs58.decode(owner)]));
  if (!b) return null;
  const v = new DataView(b.buffer);
  const xp = Number(v.getBigUint64(48, true));
  let level = 1;
  while (xp >= (100 * level * (level + 1)) / 2) level++;
  return { session: bs58.encode(b.slice(82, 114)), expires: Number(v.getBigInt64(114, true)), level, xp };
}

/** True when `sig` is a confirmed transaction signed by `from` that moved at least `amount` SKR to `to`. */
export async function tipIsReal(sig: string, from: string, to: string, amount: number, mint = Deno.env.get('SKR_MINT') ?? '') {
  const tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
  if (!tx || tx.meta?.err) return false;
  const signer = tx.transaction.message.accountKeys.find((k: { signer: boolean }) => k.signer)?.pubkey;
  if (signer !== from) return false;
  type Bal = { owner: string; mint: string; uiTokenAmount: { uiAmount: number | null } };
  const bal = (list: Bal[]) => list.filter((x) => x.owner === to && (!mint || x.mint === mint)).reduce((s, x) => s + (x.uiTokenAmount.uiAmount ?? 0), 0);
  const gained = bal(tx.meta.postTokenBalances ?? []) - bal(tx.meta.preTokenBalances ?? []);
  return gained + 1e-9 >= amount;
}

export const verify = (sigBase64: string, message: string, pubkey: string) =>
  ed25519.verify(Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0)), new TextEncoder().encode(message), bs58.decode(pubkey));

export { bs58 };
