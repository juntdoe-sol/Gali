#!/usr/bin/env node
/**
 * One-time setup for the milestone certificates (Levels 3, 6, 10, 15, 20, 30). Run it again after adding a level:
 * it reuses the collection and uploads the new card images.
 * Run cert-collection.mjs first: this reuses its authority key (./cert-authority.json).
 *
 *   cd scripts/nft && npm install
 *   SOLANA_RPC=<mainnet RPC URL> SUPABASE_URL=https://rckvfpwtdyvvvjqqlffn.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> node milestone-collection.mjs
 *
 * 1. Uploads the two certificate GIFs and stills, and the collection metadata, to the public `gali-nft` bucket.
 * 2. Creates the "Gali Milestones" Metaplex Core collection on mainnet (the authority key pays, about 0.003 SOL).
 * 3. Writes ./.milestone.env with MILESTONE_COLLECTION for: npx supabase secrets set --env-file scripts/nft/.milestone.env
 *
 * Run it again any time: a collection already in ./milestone-collection.json is reused, not made twice.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createSignerFromKeypair, generateSigner, signerIdentity, sol } from '@metaplex-foundation/umi';
import { createCollection, mplCore } from '@metaplex-foundation/mpl-core';
import bs58 from 'bs58';

const need = (k) => {
  const v = process.env[k];
  if (!v) {
    console.error(`Set ${k} first.`);
    process.exit(1);
  }
  return v;
};
const RPC = need('SOLANA_RPC');
const SB = need('SUPABASE_URL').replace(/\/$/, '');
const KEY = need('SUPABASE_SERVICE_ROLE_KEY');
const here = (f) => new URL(f, import.meta.url);

if (!existsSync(here('cert-authority.json'))) {
  console.error('No scripts/nft/cert-authority.json. Run cert-collection.mjs first (or copy the key here).');
  process.exit(1);
}
const umi = createUmi(RPC).use(mplCore());
const secret = Uint8Array.from(JSON.parse(readFileSync(here('cert-authority.json'), 'utf8')));
const auth = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret));
umi.use(signerIdentity(auth));
console.log('Collection authority:', auth.publicKey);

const bal = await umi.rpc.getBalance(auth.publicKey);
if (bal.basisPoints < sol(0.005).basisPoints) {
  console.log(`It holds ${Number(bal.basisPoints) / 1e9} SOL. Send it 0.01 SOL, then run this again.`);
  process.exit(0);
}

async function put(path, body, type) {
  const r = await fetch(`${SB}/storage/v1/object/gali-nft/${path}`, {
    method: 'POST',
    headers: { apikey: KEY, ...(KEY.startsWith('eyJ') ? { authorization: `Bearer ${KEY}` } : {}), 'content-type': type, 'x-upsert': 'true' },
    body,
  });
  if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${await r.text()}`);
  return `${SB}/storage/v1/object/public/gali-nft/${path}`;
}
const files = {};
for (const lv of [3, 6, 10, 15, 20, 30]) {
  files[`gif${lv}`] = await put(`milestone/level-${lv}.gif`, readFileSync(here(`assets/level-${lv}.gif`)), 'image/gif');
  files[`png${lv}`] = await put(`milestone/level-${lv}.png`, readFileSync(here(`assets/level-${lv}.png`)), 'image/png');
}
const colUri = await put(
  'milestone/collection.json',
  JSON.stringify({
    name: 'Gali Milestones',
    symbol: 'GALI',
    description: 'Certificates for Gali miners who reached Level 3, 6, 10, 15, 20 or 30. Each claims that level\'s gear when the Gali NFT market opens: shoes, a tee, weapons and, at Level 30, a full Legendary outfit.',
    image: files.png20,
    animation_url: files.gif20,
    external_url: 'https://gali.lol',
    properties: { files: [{ uri: files.png20, type: 'image/png' }, { uri: files.gif20, type: 'image/gif' }], category: 'image' },
  }),
  'application/json',
);
console.log('Uploaded', Object.values(files).join('\n  '), '\n ', colUri);

let collection;
if (existsSync(here('milestone-collection.json'))) {
  collection = JSON.parse(readFileSync(here('milestone-collection.json'), 'utf8')).collection;
  console.log('Reusing collection', collection);
} else {
  const col = generateSigner(umi);
  const res = await createCollection(umi, { collection: col, name: 'Gali Milestones', uri: colUri, updateAuthority: auth.publicKey }).sendAndConfirm(umi);
  collection = col.publicKey;
  writeFileSync(here('milestone-collection.json'), JSON.stringify({ collection, signature: bs58.encode(res.signature) }, null, 2));
  console.log('Created collection', collection);
}

writeFileSync(here('.milestone.env'), `MILESTONE_COLLECTION=${collection}\n`, { mode: 0o600 });
console.log('\nWrote scripts/nft/.milestone.env. Next:');
console.log('  npx supabase secrets set --env-file scripts/nft/.milestone.env');
console.log('  npx supabase functions deploy nft --no-verify-jwt');
