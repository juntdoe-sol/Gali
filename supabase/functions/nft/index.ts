// Gali NFTs: the Founding Miner certificate (closed-beta reward) and the inventory.
//
// Calls (POST, JSON body with `a` for the action):
//   status    { wallet }        is this wallet a Founding Miner, its beta stats, and its claim if any
//   build     { pass }          reserve a serial and return the mint transaction, already signed by Gali
//                               (the new asset's key and the collection authority). The miner signs as fee payer
//                               and pays the mint; nothing moves without that signature.
//   confirm   { pass, sig }     after the miner sends it: check the asset is on chain in their wallet, mark minted
//   inventory { wallet }        Gali NFTs this wallet holds (certificate now, gear later), read with Helius DAS
//
// Who qualifies: a wallet that played Gali (it is in gali_miners) and mined at least one ORE round during the
// closed beta: an ORE Deploy instruction naming the wallet as authority between CERT_BETA_START and CERT_BETA_END.
// That counts the player's own deploys and autopilot deploys made for them.
//
// The certificate is a Metaplex Core asset in the Founding Miner collection, frozen for good (a permanent freeze
// held by the collection authority), so it stays in the wallet that earned it. Its attributes carry the beta stats.
//
// Deploy: npx supabase functions deploy nft --no-verify-jwt
// Secrets: SOLANA_RPC (Helius URL, for DAS), DM_SECRET (sign-in passes), CERT_AUTHORITY (base58 secret key of the
//   collection authority, made by scripts/cert-collection.mjs), CERT_COLLECTION (collection address),
//   optional CERT_BETA_END (ISO time; open until then), GEAR_COLLECTION (later)
import { createClient } from 'npm:@supabase/supabase-js@2';
import bs58 from 'npm:bs58@6';
import { createUmi } from 'npm:@metaplex-foundation/umi-bundle-defaults@1.6.0';
import { createNoopSigner, createSignerFromKeypair, generateSigner, publicKey, signerIdentity } from 'npm:@metaplex-foundation/umi@1.6.0';
import { create, mplCore } from 'npm:@metaplex-foundation/mpl-core@1.10.0';
import { isWallet, readPass } from '../_shared/pass.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
function fail(e: unknown) {
  console.error('nft', (e as Error)?.message ?? e);
  return reply(500, { error: 'Something went wrong. Try again.' });
}

const ORE_PROGRAM = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
const CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const DEPLOY = 6;
/** Gali went live on mainnet on 1 Oct 2026 (Malaysia time). */
const BETA_START = Date.parse(Deno.env.get('CERT_BETA_START') ?? '2026-10-01T00:00:00+08:00');
const BETA_END = Deno.env.get('CERT_BETA_END') ? Date.parse(Deno.env.get('CERT_BETA_END')!) : Infinity;
const RESCAN_MS = 5 * 60_000;
const RESERVE_MS = 3 * 60_000;
const MAX_SIGS = 2000;

const rpcUrl = () => {
  const u = Deno.env.get('SOLANA_RPC');
  if (!u) throw new Error('SOLANA_RPC is not set');
  return u;
};
async function rpc<T>(method: string, params: unknown): Promise<T> {
  const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result as T;
}
/** Many calls in one request (Helius takes JSON-RPC batches). */
async function rpcBatch<T>(calls: { method: string; params: unknown }[]): Promise<(T | null)[]> {
  if (!calls.length) return [];
  const r = await fetch(rpcUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }))),
  });
  const j = (await r.json()) as { id: number; result?: T }[];
  const out: (T | null)[] = calls.map(() => null);
  for (const e of j) out[e.id] = e.result ?? null;
  return out;
}

type Sig = { signature: string; blockTime: number | null; err: unknown };
type Tx = { transaction: { message: { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[] } }; meta: { loadedAddresses?: { writable: string[]; readonly: string[] } } | null } | null;

/** Scan the wallet's history for ORE deploys in the beta window. Incremental: only new signatures after the last scan. */
async function scan(wallet: string) {
  const { data: row } = await db.from('founding_miners').select('*').eq('wallet', wallet).maybeSingle();
  if (row && Date.now() - Date.parse(row.scanned_at) < RESCAN_MS) return row;
  const keys = new Set<string>(row?.round_keys ?? []);
  let first = row?.first_at ? Date.parse(row.first_at) : Infinity;
  const sigs: Sig[] = [];
  let before: string | undefined;
  while (sigs.length < MAX_SIGS) {
    const page = await rpc<Sig[]>('getSignaturesForAddress', [wallet, { limit: 1000, before, until: row?.last_sig ?? undefined }]);
    if (!page.length) break;
    sigs.push(...page);
    const oldest = page[page.length - 1];
    if (page.length < 1000 || (oldest.blockTime ?? 0) * 1000 < BETA_START) break;
    before = oldest.signature;
  }
  const want = sigs.filter((s) => !s.err && s.blockTime && s.blockTime * 1000 >= BETA_START && s.blockTime * 1000 <= BETA_END);
  for (let i = 0; i < want.length; i += 50) {
    const chunk = want.slice(i, i + 50);
    const txs = await rpcBatch<Tx>(chunk.map((s) => ({ method: 'getTransaction', params: [s.signature, { encoding: 'json', maxSupportedTransactionVersion: 0, commitment: 'confirmed' }] })));
    txs.forEach((tx, k) => {
      if (!tx) return;
      const m = tx.transaction.message;
      const all = [...m.accountKeys, ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? [])];
      for (const ix of m.instructions) {
        if (all[ix.programIdIndex] !== ORE_PROGRAM) continue;
        const data = bs58.decode(ix.data);
        // Deploy: [signer, authority, automation, board, config, miner, round, ...]
        if (data[0] !== DEPLOY || all[ix.accounts[1]] !== wallet) continue;
        keys.add(all[ix.accounts[6]]);
        first = Math.min(first, chunk[k].blockTime! * 1000);
      }
    });
  }
  const next = {
    wallet,
    rounds: keys.size,
    round_keys: [...keys].slice(-5000),
    first_at: Number.isFinite(first) ? new Date(first).toISOString() : null,
    last_sig: sigs[0]?.signature ?? row?.last_sig ?? null,
    scanned_at: new Date().toISOString(),
  };
  await db.from('founding_miners').upsert(next);
  return next;
}

async function status(wallet: string) {
  const { data: miner } = await db.from('gali_miners').select('wallet, name').eq('wallet', wallet).maybeSingle();
  const { data: claim } = await db.from('cert_claims').select('serial, asset, status, rounds, first_at').eq('wallet', wallet).maybeSingle();
  if (claim?.status === 'minted') return { eligible: true, rounds: claim.rounds, firstAt: claim.first_at, name: miner?.name ?? null, claim, open: mintOpen() };
  if (!miner) return { eligible: false, reason: 'not-a-gali-miner', rounds: 0, firstAt: null, claim: null, open: mintOpen() };
  const s = await scan(wallet);
  return { eligible: s.rounds > 0, reason: s.rounds > 0 ? null : 'no-beta-rounds', rounds: s.rounds, firstAt: s.first_at, name: miner.name, claim: claim ?? null, open: mintOpen() };
}

const mintOpen = () => Boolean(Deno.env.get('CERT_AUTHORITY') && Deno.env.get('CERT_COLLECTION')) && Date.now() <= BETA_END + 30 * 86_400_000;
const pad = (n: number) => String(n).padStart(4, '0');
const day = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '');

/** Storage auth: a legacy service_role JWT goes as apikey and Bearer, a new sb_secret_ key as apikey only. */
function storageAuth(): Record<string, string> {
  const k = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return k.startsWith('eyJ') ? { apikey: k, authorization: `Bearer ${k}` } : { apikey: k };
}

/** Write the certificate's metadata JSON to the public bucket and return its URL. */
async function uploadMeta(serial: number, name: string | null, rounds: number, firstAt: string | null) {
  const base = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/gali-nft`;
  const meta = {
    name: `Gali Founding Miner #${pad(serial)}`,
    symbol: 'GALI',
    description: 'Mined ORE on Gali Island during the closed beta. Claim the Legendary Jarl Helmet with this certificate when the Gali NFT market opens. Soulbound: it stays with the wallet that earned it.',
    image: `${base}/cert/founding-miner.gif`,
    animation_url: `${base}/cert/founding-miner.gif`,
    external_url: 'https://gali.lol',
    attributes: [
      { trait_type: 'Serial', value: pad(serial) },
      { trait_type: 'Miner', value: name ?? 'anon' },
      { trait_type: 'Beta rounds mined', value: rounds },
      { trait_type: 'First dig', value: day(firstAt) },
      { trait_type: 'Reward', value: 'Jarl Helmet (Legendary)' },
      { trait_type: 'Reward status', value: 'Unclaimed' },
    ],
    properties: { files: [{ uri: `${base}/cert/founding-miner.gif`, type: 'image/gif' }], category: 'image' },
  };
  const path = `cert/${pad(serial)}.json`;
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/storage/v1/object/gali-nft/${path}`, {
    method: 'POST',
    headers: { ...storageAuth(), 'content-type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify(meta),
  });
  if (!r.ok) throw new Error(`metadata upload ${r.status}`);
  return { uri: `${base}/${path}`, meta };
}

async function build(wallet: string) {
  if (!mintOpen()) return reply(409, { error: 'The certificate mint is not open yet.' });
  const st = await status(wallet);
  if (!st.eligible) return reply(403, { error: 'This wallet did not mine a live round in the closed beta.' });
  if (st.claim?.status === 'minted') return reply(409, { error: 'Already claimed', claim: st.claim });

  const umi = createUmi(rpcUrl()).use(mplCore());
  const auth = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(bs58.decode(Deno.env.get('CERT_AUTHORITY')!)));
  umi.use(signerIdentity(auth));
  const asset = generateSigner(umi);

  // reserve (or re-reserve) the serial; a reservation the miner never sent is simply replaced with a new asset key
  let serial: number;
  if (st.claim) {
    const age = Date.now() - Date.parse((await db.from('cert_claims').select('reserved_at').eq('wallet', wallet).single()).data!.reserved_at);
    if (age < RESERVE_MS && (await assetOwner(st.claim.asset)) === wallet) return reply(409, { error: 'Already claimed', claim: st.claim });
    serial = st.claim.serial;
    await db.from('cert_claims').update({ asset: asset.publicKey, reserved_at: new Date().toISOString(), rounds: st.rounds, first_at: st.firstAt }).eq('wallet', wallet).eq('status', 'reserved');
  } else {
    const { data, error } = await db.from('cert_claims').insert({ wallet, asset: asset.publicKey, rounds: st.rounds, first_at: st.firstAt }).select('serial').single();
    if (error) throw error;
    serial = data.serial;
  }
  const { uri } = await uploadMeta(serial, st.name, st.rounds, st.firstAt);
  const miner = createNoopSigner(publicKey(wallet));
  const collection = { publicKey: publicKey(Deno.env.get('CERT_COLLECTION')!), updateAuthority: auth.publicKey };
  const bh = await umi.rpc.getLatestBlockhash({ commitment: 'confirmed' });
  const tx = await create(umi, {
    asset,
    collection,
    owner: miner.publicKey,
    payer: miner,
    authority: auth,
    name: `Gali Founding Miner #${pad(serial)}`,
    uri,
    plugins: [
      { type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'UpdateAuthority' } },
      {
        type: 'Attributes',
        attributeList: [
          { key: 'Serial', value: pad(serial) },
          { key: 'Beta rounds mined', value: String(st.rounds) },
          { key: 'First dig', value: day(st.firstAt) },
          { key: 'Reward', value: 'Jarl Helmet' },
          { key: 'Reward status', value: 'Unclaimed' },
        ],
      },
    ],
  })
    .setFeePayer(miner)
    .setVersion('legacy')
    .setBlockhash(bh)
    .buildAndSign(umi);
  const b64 = btoa(String.fromCharCode(...umi.transactions.serialize(tx)));
  return reply(200, { tx: b64, asset: asset.publicKey, serial, lastValidBlockHeight: Number(bh.lastValidBlockHeight) });
}

/** The Core asset's owner, read from its account (key byte, then the 32-byte owner). */
async function assetOwner(asset: string): Promise<string | null> {
  const acc = await rpc<{ value: { owner: string; data: [string, string] } | null }>('getAccountInfo', [asset, { encoding: 'base64', commitment: 'confirmed' }]);
  if (!acc.value || acc.value.owner !== CORE_PROGRAM) return null;
  const raw = Uint8Array.from(atob(acc.value.data[0]), (c) => c.charCodeAt(0));
  return bs58.encode(raw.slice(1, 33));
}

async function confirm(wallet: string, sig: string) {
  const { data: claim } = await db.from('cert_claims').select('*').eq('wallet', wallet).maybeSingle();
  if (!claim) return reply(404, { error: 'No claim for this wallet' });
  if (claim.status === 'minted') return reply(200, { claim });
  const owner = await assetOwner(claim.asset);
  if (owner !== wallet) return reply(202, { pending: true });
  const { data } = await db
    .from('cert_claims')
    .update({ status: 'minted', minted_at: new Date().toISOString(), sig: typeof sig === 'string' ? sig.slice(0, 100) : null })
    .eq('wallet', wallet)
    .select('serial, asset, status, rounds, first_at')
    .single();
  return reply(200, { claim: data });
}

type DasAsset = { id: string; content?: { metadata?: { name?: string; attributes?: { trait_type: string; value: unknown }[] }; links?: { image?: string } }; grouping?: { group_key: string; group_value: string }[] };
async function inventory(wallet: string) {
  const mine = new Set([Deno.env.get('CERT_COLLECTION'), Deno.env.get('GEAR_COLLECTION')].filter(Boolean) as string[]);
  if (!mine.size) return reply(200, { items: [] });
  const r = await rpc<{ items: DasAsset[] }>('getAssetsByOwner', { ownerAddress: wallet, page: 1, limit: 1000 });
  const items = r.items
    .map((a) => ({ a, col: a.grouping?.find((g) => g.group_key === 'collection')?.group_value }))
    .filter(({ col }) => col && mine.has(col))
    .map(({ a, col }) => ({
      id: a.id,
      name: a.content?.metadata?.name ?? '',
      image: a.content?.links?.image ?? null,
      kind: col === Deno.env.get('CERT_COLLECTION') ? 'cert' : 'gear',
      attributes: a.content?.metadata?.attributes ?? [],
    }));
  return reply(200, { items });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 2000) return reply(413, { error: 'too big' });
    const q = await req.json();
    const a = String(q?.a ?? '');
    if (a === 'status' || a === 'inventory') {
      if (!isWallet(q.wallet)) return reply(400, { error: 'wallet' });
      return a === 'status' ? reply(200, await status(q.wallet)) : await inventory(q.wallet);
    }
    const me = await readPass(q?.pass);
    if (!me) return reply(401, { error: 'Sign in again' });
    if (a === 'build') return await build(me);
    if (a === 'confirm') return await confirm(me, q.sig);
    return reply(400, { error: 'unknown action' });
  } catch (e) {
    return fail(e);
  }
});
