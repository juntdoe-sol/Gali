#!/usr/bin/env node
/**
 * One-time setup for the Founding Miner certificate.
 *
 *   cd scripts/nft && npm install
 *   SOLANA_RPC=<mainnet RPC URL> SUPABASE_URL=https://rckvfpwtdyvvvjqqlffn.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> node cert-collection.mjs
 *
 * 1. Makes (or reuses) the collection authority key in ./cert-authority.json. This key signs every certificate
 *    mint from the `nft` function. It never leaves this folder and your Supabase secrets. Keep a backup offline.
 * 2. Stops until that key holds 0.02 SOL (it pays for the collection account once).
 * 3. Uploads the certificate GIF, a still and the collection metadata to the public `gali-nft` bucket
 *    (run supabase/sql/founding-miner.sql first; it makes the bucket).
 * 4. Creates the "Gali Founding Miners" Metaplex Core collection on mainnet with that key as update authority.
 * 5. Writes ./.cert.env with CERT_AUTHORITY and CERT_COLLECTION for: npx supabase secrets set --env-file scripts/nft/.cert.env
 *
 * Run it again any time: a collection already in ./cert-collection.json is reused, not made twice.
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

const umi = createUmi(RPC).use(mplCore());
let secret;
if (existsSync(here('cert-authority.json'))) secret = Uint8Array.from(JSON.parse(readFileSync(here('cert-authority.json'), 'utf8')));
else {
  const kp = umi.eddsa.generateKeypair();
  secret = kp.secretKey;
  writeFileSync(here('cert-authority.json'), JSON.stringify([...secret]), { mode: 0o600 });
  console.log('Made a new collection authority key in scripts/nft/cert-authority.json (keep a backup offline).');
}
const auth = createSignerFromKeypair(umi, umi.eddsa.createKeypairFromSecretKey(secret));
umi.use(signerIdentity(auth));
console.log('Collection authority:', auth.publicKey);

const bal = await umi.rpc.getBalance(auth.publicKey);
if (bal.basisPoints < sol(0.02).basisPoints) {
  console.log(`It holds ${Number(bal.basisPoints) / 1e9} SOL. Send it 0.02 SOL, then run this again.`);
  process.exit(0);
}

async function put(path, body, type) {
  const r = await fetch(`${SB}/storage/v1/object/gali-nft/${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': type, 'x-upsert': 'true' },
    body,
  });
  if (!r.ok) throw new Error(`upload ${path}: ${r.status} ${await r.text()}`);
  return `${SB}/storage/v1/object/public/gali-nft/${path}`;
}
const gif = await put('cert/founding-miner.gif', readFileSync(here('assets/founding-miner.gif')), 'image/gif');
const png = await put('cert/founding-miner.png', readFileSync(here('assets/founding-miner.png')), 'image/png');
const colUri = await put(
  'cert/collection.json',
  JSON.stringify({
    name: 'Gali Founding Miners',
    symbol: 'GALI',
    description: 'Certificates for the miners who mined ORE on Gali Island during the closed beta. Each one claims a Legendary Jarl Helmet when the Gali NFT market opens.',
    image: png,
    animation_url: gif,
    external_url: 'https://gali.lol',
    properties: { files: [{ uri: png, type: 'image/png' }, { uri: gif, type: 'image/gif' }], category: 'image' },
  }),
  'application/json',
);
console.log('Uploaded', gif, png, colUri);

let collection;
if (existsSync(here('cert-collection.json'))) {
  collection = JSON.parse(readFileSync(here('cert-collection.json'), 'utf8')).collection;
  console.log('Reusing collection', collection);
} else {
  const col = generateSigner(umi);
  const res = await createCollection(umi, { collection: col, name: 'Gali Founding Miners', uri: colUri, updateAuthority: auth.publicKey }).sendAndConfirm(umi);
  collection = col.publicKey;
  writeFileSync(here('cert-collection.json'), JSON.stringify({ collection, signature: bs58.encode(res.signature) }, null, 2));
  console.log('Created collection', collection);
}

writeFileSync(here('.cert.env'), `CERT_AUTHORITY=${bs58.encode(secret)}\nCERT_COLLECTION=${collection}\n`, { mode: 0o600 });
console.log('\nWrote scripts/nft/.cert.env. Next:');
console.log('  npx supabase secrets set --env-file scripts/nft/.cert.env');
console.log('  npx supabase functions deploy nft --no-verify-jwt');
console.log(`  and put EXPO_PUBLIC_CERT_COLLECTION=${collection} in app/.env.local and the EAS profiles.`);
