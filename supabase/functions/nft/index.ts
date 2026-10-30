// Gali NFTs: the Founding Miner certificate (closed-beta reward), the Level 10 and Level 20 milestone
// certificates, and the inventory.
//
// Calls (POST, JSON body with `a` for the action):
//   status    { wallet }        is this wallet a Founding Miner, its beta stats, and its claim if any
//   build     { pass }          reserve a serial and return the mint transaction, already signed by Gali
//                               (the new asset's key and the collection authority). The miner signs as fee payer
//                               and pays the mint; nothing moves without that signature.
//   confirm   { pass, sig }     after the miner sends it: check the asset is on chain in their wallet, mark minted
//   inventory { wallet }        Gali NFTs this wallet holds (certificates now, gear later), read with Helius DAS
//   build and confirm take an optional `kind`: 'lv10' or 'lv20' for a milestone certificate (default: Founding Miner).
//   status also returns `milestones`: the wallet's level and each milestone's claim.
//
// Milestones: a wallet whose server-worked level (gali_miners.level, from verified XP) reached 10 or 20 mints a
// certificate in the Gali Milestones collection (MILESTONE_COLLECTION, same authority key as the Founding Miners).
// Each one claims ONE weapon of its milestone's three, picked at random when the Gali NFT market opens.
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
//   optional CERT_BETA_END (ISO time; open until then), MILESTONE_COLLECTION (scripts/nft/milestone-collection.mjs),
//   GEAR_COLLECTION (later), optional CERT_FEE_WALLET (gets the claim fee; default: Gali's revenue wallet),
//   optional CERT_FEE_SOL (claim fee per certificate, default 0.005; 0 turns it off)
import { createClient } from 'npm:@supabase/supabase-js@2';
import bs58 from 'npm:bs58@6';
import { createUmi } from 'npm:@metaplex-foundation/umi-bundle-defaults@1.6.0';
import { createNoopSigner, createSignerFromKeypair, generateSigner, publicKey, signerIdentity, transactionBuilder } from 'npm:@metaplex-foundation/umi@1.6.0';
import { create, mplCore } from 'npm:@metaplex-foundation/mpl-core@1.10.0';
import { isWallet, readPass } from '../_shared/pass.ts';
import { minerAddress } from '../_shared/ore.ts';

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
/** Time one call may spend reading history; a long history carries on in the next call. */
const SCAN_BUDGET_MS = 20_000;
const SCAN_CONCURRENCY = 4;

const rpcUrl = () => {
  const u = Deno.env.get('SOLANA_RPC');
  if (!u) throw new Error('SOLANA_RPC is not set');
  return u;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** One RPC call. A busy provider (429, or a non-JSON reply) is retried with a growing wait. */
async function rpc<T>(method: string, params: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(rpcUrl(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
    const text = await r.text();
    let j: { error?: { message?: string; code?: number }; result?: T } | null = null;
    try {
      j = JSON.parse(text);
    } catch {
      j = null;
    }
    const busy = r.status === 429 || !j || j.error?.code === 429 || /rate limit|too many/i.test(j?.error?.message ?? '');
    if (busy && attempt < 5) {
      await sleep(600 * (attempt + 1) + Math.random() * 300);
      continue;
    }
    if (!j) throw new Error(`RPC ${method}: ${r.status} ${text.slice(0, 60)}`);
    if (j.error) throw new Error(j.error.message ?? 'RPC error');
    return j.result as T;
  }
}
/** Run `fn` over `items`, a few at a time. */
async function pool<I>(items: I[], n: number, fn: (it: I) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  }));
}

type Sig = { signature: string; blockTime: number | null; err: unknown };
type Tx = { transaction: { message: { accountKeys: string[]; instructions: { programIdIndex: number; accounts: number[]; data: string }[] } }; meta: { loadedAddresses?: { writable: string[]; readonly: string[] } } | null } | null;

/**
 * Count the wallet's ORE rounds in the beta window. Reads the history of the wallet's ORE Miner account (only ORE
 * touches it, so it is far shorter than the wallet's own history) and keeps every Deploy that names the wallet as
 * authority. A long history is read over several calls: `scan_cursor` marks where the last call stopped, `pass_top` the
 * newest signature of the pass in progress, `last_sig` the newest one a finished pass has covered.
 */
async function scan(wallet: string) {
  const { data: row } = await db.from('founding_miners').select('*').eq('wallet', wallet).maybeSingle();
  if (row?.done && Date.now() - Date.parse(row.scanned_at) < RESCAN_MS) return row;
  const started = Date.now();
  const miner = await minerAddress(wallet);
  const keys = new Set<string>(row?.round_keys ?? []);
  let first = row?.first_at ? Date.parse(row.first_at) : Infinity;
  let cursor: string | null = row && !row.done ? row.scan_cursor ?? null : null;
  let top: string | null = row && !row.done ? row.pass_top ?? null : null;
  const until = row?.last_sig ?? undefined;
  let done = false;
  while (Date.now() - started < SCAN_BUDGET_MS) {
    const page = await rpc<Sig[]>('getSignaturesForAddress', [miner, { limit: 200, before: cursor ?? undefined, until }]);
    if (!top) top = page[0]?.signature ?? until ?? null;
    if (!page.length) {
      done = true;
      break;
    }
    const want = page.filter((s) => !s.err && s.blockTime && s.blockTime * 1000 >= BETA_START && s.blockTime * 1000 <= BETA_END);
    await pool(want, SCAN_CONCURRENCY, async (sg) => {
      // newer transaction versions are fine: we only read keys and instructions. One unreadable transaction is skipped.
      const tx = await rpc<Tx>('getTransaction', [sg.signature, { encoding: 'json', maxSupportedTransactionVersion: 1, commitment: 'confirmed' }]).catch(() => null);
      const m = tx?.transaction?.message;
      if (!m?.accountKeys || !m.instructions) return;
      const all = [...m.accountKeys, ...(tx?.meta?.loadedAddresses?.writable ?? []), ...(tx?.meta?.loadedAddresses?.readonly ?? [])];
      for (const ix of m.instructions) {
        if (all[ix.programIdIndex] !== ORE_PROGRAM) continue;
        const data = bs58.decode(ix.data);
        // Deploy: [signer, authority, automation, board, config, miner, round, ...]
        if (data[0] !== DEPLOY || all[ix.accounts[1]] !== wallet) continue;
        keys.add(all[ix.accounts[6]]);
        first = Math.min(first, sg.blockTime! * 1000);
      }
    });
    cursor = page[page.length - 1].signature;
    const oldest = (page[page.length - 1].blockTime ?? 0) * 1000;
    if (page.length < 200 || oldest < BETA_START) {
      done = true;
      break;
    }
  }
  const next = {
    wallet,
    rounds: keys.size,
    round_keys: [...keys].slice(-20000),
    first_at: Number.isFinite(first) ? new Date(first).toISOString() : null,
    last_sig: done ? top ?? row?.last_sig ?? null : row?.last_sig ?? null,
    pass_top: done ? null : top,
    scan_cursor: done ? null : cursor,
    done,
    scanned_at: new Date().toISOString(),
  };
  await db.from('founding_miners').upsert(next);
  return next;
}

async function status(wallet: string) {
  const [founding, ms] = await Promise.all([foundingStatus(wallet), milestones(wallet).catch(() => null)]);
  return { ...founding, milestones: ms, fee: claimFee() };
}
async function foundingStatus(wallet: string) {
  const { data: miner } = await db.from('gali_miners').select('wallet, name').eq('wallet', wallet).maybeSingle();
  const { data: claim } = await db.from('cert_claims').select('serial, asset, status, rounds, first_at').eq('wallet', wallet).maybeSingle();
  if (claim?.status === 'minted') return { eligible: true, rounds: claim.rounds, firstAt: claim.first_at, name: miner?.name ?? null, claim, open: mintOpen() };
  if (!miner) return { eligible: false, reason: 'not-a-gali-miner', rounds: 0, firstAt: null, claim: null, open: mintOpen() };
  const s = await scan(wallet);
  return { eligible: s.rounds > 0, reason: s.rounds > 0 ? null : s.done ? 'no-beta-rounds' : 'counting', counting: !s.done, rounds: s.rounds, firstAt: s.first_at, name: miner.name, claim: claim ?? null, open: mintOpen() };
}

const mintOpen = () => Boolean(Deno.env.get('CERT_AUTHORITY') && Deno.env.get('CERT_COLLECTION')) && Date.now() <= BETA_END + 30 * 86_400_000;

/**
 * The milestone certificates. Each claims its level's gear when the market opens: the one item, or one of several
 * rolled at random (Level 30: one full outfit, top and pants).
 */
type Kind = 'lv3' | 'lv6' | 'lv10' | 'lv15' | 'lv20' | 'lv30';
const MILESTONES: Record<Kind, { level: number; rarity: string; title: string; reward: string; rewards: string[] }> = {
  lv3: { level: 3, rarity: 'Uncommon', title: 'Level 3', reward: 'Baby Steps Boots (Uncommon shoes)', rewards: ['Baby Steps Boots'] },
  lv6: { level: 6, rarity: 'Uncommon', title: 'Level 6', reward: 'Six Pack Tee (Uncommon top)', rewards: ['Six Pack Tee'] },
  lv10: { level: 10, rarity: 'Rare', title: 'Level 10', reward: '1 random Rare weapon', rewards: ['Ten Bagger Pick', 'Level Up Pick', 'XP Bar Blade'] },
  lv15: { level: 15, rarity: 'Rare', title: 'Level 15', reward: '1 random pair of Rare shoes', rewards: ['Ore Crusher Boots', 'Speedrun Sneakers', 'Lava Walkers'] },
  lv20: { level: 20, rarity: 'Legendary', title: 'Level 20', reward: '1 random Legendary weapon', rewards: ['Wen Moon Hammer', 'Bull Run Axe', 'Genesis Block Hammer'] },
  lv30: {
    level: 30,
    rarity: 'Legendary',
    title: 'Level 30',
    reward: '1 random Legendary outfit (top and pants)',
    rewards: ['Ore King Regalia', 'Gradient Prime Suit', 'Pump Tracksuit', 'Magma Core Suit', 'Frost Vein Armour', 'Void Walker Suit', 'Overclock Hazmat', 'Ronin Miner Gi', 'Gold Rush Duster', 'Astro Miner Suit'],
  },
};
const isKind = (k: unknown): k is Kind => typeof k === 'string' && Object.prototype.hasOwnProperty.call(MILESTONES, k);
const milestoneOpen = () => Boolean(Deno.env.get('CERT_AUTHORITY') && Deno.env.get('MILESTONE_COLLECTION'));

type MClaim = { kind: Kind; serial: number; asset: string; status: 'reserved' | 'minted'; level: number; reserved_at: string };
async function milestones(wallet: string) {
  const [{ data: miner }, { data: rows }] = await Promise.all([
    db.from('gali_miners').select('level, xp').eq('wallet', wallet).maybeSingle(),
    db.from('milestone_claims').select('kind, serial, asset, status, level, reserved_at').eq('wallet', wallet),
  ]);
  const level = Number(miner?.level ?? 0);
  const out: Record<Kind, { need: number; rarity: string; eligible: boolean; claim: MClaim | null }> = {} as never;
  for (const k of Object.keys(MILESTONES) as Kind[]) {
    const c = (rows ?? []).find((r) => r.kind === k) as MClaim | undefined;
    out[k] = { need: MILESTONES[k].level, rarity: MILESTONES[k].rarity, eligible: level >= MILESTONES[k].level, claim: c ?? null };
  }
  return { level, xp: Number(miner?.xp ?? 0), open: milestoneOpen(), ...out };
}
/**
 * A priority fee, so the mint lands when mainnet is busy (the game's own transactions carry one too; without it the
 * network dropped the first claims). Compute budget: price per compute unit, and a unit limit sized for a Core create.
 */
const PRIORITY_MICROLAMPORTS = Number(Deno.env.get('CERT_PRIORITY_MICROLAMPORTS') ?? 200_000);
const CU_LIMIT = 200_000;
const COMPUTE_BUDGET = publicKey('ComputeBudget111111111111111111111111111111');
function computeBudget() {
  const price = new Uint8Array(9);
  price[0] = 3;
  new DataView(price.buffer).setBigUint64(1, BigInt(PRIORITY_MICROLAMPORTS), true);
  const limit = new Uint8Array(5);
  limit[0] = 2;
  new DataView(limit.buffer).setUint32(1, CU_LIMIT, true);
  return transactionBuilder()
    .add({ instruction: { programId: COMPUTE_BUDGET, keys: [], data: limit }, signers: [], bytesCreatedOnChain: 0 })
    .add({ instruction: { programId: COMPUTE_BUDGET, keys: [], data: price }, signers: [], bytesCreatedOnChain: 0 });
}

/**
 * The claim fee: the miner pays it to the admin wallet in the same transaction as the mint, so a certificate is never
 * minted without it (Gali has already signed the transaction; changing it breaks those signatures).
 */
const FEE_SOL = Number(Deno.env.get('CERT_FEE_SOL') ?? 0.005);
/** Gali's revenue wallet: the deploy fee and the arcade fees go here too (app/src/chain/light.ts REVENUE_WALLET). */
const REVENUE_WALLET = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
const feeWallet = () => {
  const w = (Deno.env.get('CERT_FEE_WALLET') ?? REVENUE_WALLET).trim();
  return isWallet(w) ? w : null;
};
/** The fee a claim costs right now, in SOL (0 when no fee wallet is set). */
const claimFee = () => (feeWallet() && FEE_SOL > 0 ? FEE_SOL : 0);
const SYSTEM_PROGRAM = publicKey('11111111111111111111111111111111');
function feeIx(payer: ReturnType<typeof createNoopSigner>) {
  const to = feeWallet();
  const fee = claimFee();
  if (!to || !fee) return transactionBuilder();
  const data = new Uint8Array(12);
  const dv = new DataView(data.buffer);
  dv.setUint32(0, 2, true); // SystemProgram Transfer
  dv.setBigUint64(4, BigInt(Math.round(fee * 1e9)), true);
  return transactionBuilder().add({
    instruction: {
      programId: SYSTEM_PROGRAM,
      keys: [
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: publicKey(to), isSigner: false, isWritable: true },
      ],
      data,
    },
    signers: [payer],
    bytesCreatedOnChain: 0,
  });
}

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
  if ((st as { counting?: boolean }).counting) return reply(409, { error: 'Still counting your beta rounds. Try again in a minute.' });
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
  const tx = await computeBudget().add(feeIx(miner)).add(create(umi, {
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
  }))
    .setFeePayer(miner)
    .setVersion('legacy')
    .setBlockhash(bh)
    .buildAndSign(umi);
  const b64 = btoa(String.fromCharCode(...umi.transactions.serialize(tx)));
  return reply(200, { tx: b64, asset: asset.publicKey, serial, lastValidBlockHeight: Number(bh.lastValidBlockHeight) });
}

/** Write a milestone certificate's metadata JSON to the public bucket and return its URL. */
async function uploadMilestoneMeta(kind: Kind, serial: number, name: string | null, level: number) {
  const m = MILESTONES[kind];
  const base = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/gali-nft`;
  const img = `${base}/milestone/level-${m.level}.gif`;
  const meta = {
    name: `Gali ${m.title} Certificate #${pad(serial)}`,
    symbol: 'GALI',
    description:
      m.rewards.length > 1
        ? `Reached ${m.title} on Gali Island. Claims ${m.reward} when the Gali NFT market opens, one of: ${m.rewards.join(', ')}. Soulbound: it stays with the wallet that earned it.`
        : `Reached ${m.title} on Gali Island. Claims the ${m.reward} when the Gali NFT market opens. Soulbound: it stays with the wallet that earned it.`,
    image: img,
    animation_url: img,
    external_url: 'https://gali.lol',
    attributes: [
      { trait_type: 'Serial', value: pad(serial) },
      { trait_type: 'Miner', value: name ?? 'anon' },
      { trait_type: 'Milestone', value: m.title },
      { trait_type: 'Level at claim', value: level },
      { trait_type: 'Rarity', value: m.rarity },
      { trait_type: 'Reward', value: m.reward },
      { trait_type: 'Reward status', value: 'Unclaimed' },
    ],
    properties: { files: [{ uri: img, type: 'image/gif' }], category: 'image' },
  };
  const path = `milestone/${kind}-${pad(serial)}.json`;
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/storage/v1/object/gali-nft/${path}`, {
    method: 'POST',
    headers: { ...storageAuth(), 'content-type': 'application/json', 'x-upsert': 'true' },
    body: JSON.stringify(meta),
  });
  if (!r.ok) throw new Error(`metadata upload ${r.status}`);
  return `${base}/${path}`;
}

async function buildMilestone(wallet: string, kind: Kind) {
  if (!milestoneOpen()) return reply(409, { error: 'The milestone mint is not open yet.' });
  const m = MILESTONES[kind];
  const { data: miner } = await db.from('gali_miners').select('name, level').eq('wallet', wallet).maybeSingle();
  const level = Number(miner?.level ?? 0);
  if (level < m.level) return reply(403, { error: `Reach ${m.title} first. You are level ${level}.` });
  const { data: prev } = await db.from('milestone_claims').select('*').eq('wallet', wallet).eq('kind', kind).maybeSingle();
  if (prev?.status === 'minted') return reply(409, { error: 'Already claimed', claim: prev });

  const umi = createUmi(rpcUrl()).use(mplCore());
  const auth = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(bs58.decode(Deno.env.get('CERT_AUTHORITY')!)));
  umi.use(signerIdentity(auth));
  const asset = generateSigner(umi);

  let serial: number;
  if (prev) {
    if (Date.now() - Date.parse(prev.reserved_at) < RESERVE_MS && (await assetOwner(prev.asset)) === wallet) return reply(409, { error: 'Already claimed', claim: prev });
    serial = prev.serial;
    await db.from('milestone_claims').update({ asset: asset.publicKey, reserved_at: new Date().toISOString(), level }).eq('id', prev.id).eq('status', 'reserved');
  } else {
    // serials count per milestone; two claims at once can pick the same number, so the loser takes the next one
    serial = 0;
    for (let k = 0; k < 5 && !serial; k++) {
      const { data: top } = await db.from('milestone_claims').select('serial').eq('kind', kind).order('serial', { ascending: false }).limit(1).maybeSingle();
      const next = Number(top?.serial ?? 0) + 1;
      const { error } = await db.from('milestone_claims').insert({ wallet, kind, serial: next, asset: asset.publicKey, level });
      if (!error) serial = next;
      else if (!/duplicate|unique/i.test(error.message)) throw error;
      else if (/wallet/i.test(error.message)) return reply(409, { error: 'A claim is already in progress. Try again in a minute.' });
    }
    if (!serial) throw new Error('could not reserve a serial');
  }
  const uri = await uploadMilestoneMeta(kind, serial, miner?.name ?? null, level);
  const payer = createNoopSigner(publicKey(wallet));
  const collection = { publicKey: publicKey(Deno.env.get('MILESTONE_COLLECTION')!), updateAuthority: auth.publicKey };
  const bh = await umi.rpc.getLatestBlockhash({ commitment: 'confirmed' });
  const tx = await computeBudget().add(feeIx(payer)).add(create(umi, {
    asset,
    collection,
    owner: payer.publicKey,
    payer,
    authority: auth,
    name: `Gali ${m.title} Certificate #${pad(serial)}`,
    uri,
    plugins: [
      { type: 'PermanentFreezeDelegate', frozen: true, authority: { type: 'UpdateAuthority' } },
      {
        type: 'Attributes',
        attributeList: [
          { key: 'Serial', value: pad(serial) },
          { key: 'Milestone', value: m.title },
          { key: 'Level at claim', value: String(level) },
          { key: 'Rarity', value: m.rarity },
          { key: 'Reward', value: m.reward },
          { key: 'Reward status', value: 'Unclaimed' },
        ],
      },
    ],
  }))
    .setFeePayer(payer)
    .setVersion('legacy')
    .setBlockhash(bh)
    .buildAndSign(umi);
  const b64 = btoa(String.fromCharCode(...umi.transactions.serialize(tx)));
  return reply(200, { tx: b64, asset: asset.publicKey, serial, kind, lastValidBlockHeight: Number(bh.lastValidBlockHeight) });
}

async function confirmMilestone(wallet: string, kind: Kind, sig: string) {
  const { data: claim } = await db.from('milestone_claims').select('*').eq('wallet', wallet).eq('kind', kind).maybeSingle();
  if (!claim) return reply(404, { error: 'No claim for this wallet' });
  if (claim.status === 'minted') return reply(200, { claim });
  if ((await assetOwner(claim.asset)) !== wallet) return reply(202, { pending: true });
  const { data } = await db
    .from('milestone_claims')
    .update({ status: 'minted', minted_at: new Date().toISOString(), sig: typeof sig === 'string' ? sig.slice(0, 100) : null })
    .eq('id', claim.id)
    .select('kind, serial, asset, status, level, reserved_at')
    .single();
  return reply(200, { claim: data });
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
  const certCols = new Set([Deno.env.get('CERT_COLLECTION'), Deno.env.get('MILESTONE_COLLECTION')].filter(Boolean) as string[]);
  const mine = new Set([...certCols, Deno.env.get('GEAR_COLLECTION')].filter(Boolean) as string[]);
  if (!mine.size) return reply(200, { items: [] });
  const r = await rpc<{ items: DasAsset[] }>('getAssetsByOwner', { ownerAddress: wallet, page: 1, limit: 1000 });
  const items = r.items
    .map((a) => ({ a, col: a.grouping?.find((g) => g.group_key === 'collection')?.group_value }))
    .filter(({ col }) => col && mine.has(col))
    .map(({ a, col }) => ({
      id: a.id,
      name: a.content?.metadata?.name ?? '',
      image: a.content?.links?.image ?? null,
      kind: certCols.has(col!) ? 'cert' : 'gear',
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
    if (q.kind !== undefined && q.kind !== 'founding' && !isKind(q.kind)) return reply(400, { error: 'kind' });
    const kind = isKind(q.kind) ? q.kind : null;
    if (a === 'build') return kind ? await buildMilestone(me, kind) : await build(me);
    if (a === 'confirm') return kind ? await confirmMilestone(me, kind, q.sig) : await confirm(me, q.sig);
    return reply(400, { error: 'unknown action' });
  } catch (e) {
    return fail(e);
  }
});
