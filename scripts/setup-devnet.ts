/**
 * One-time devnet setup, safe to re-run:
 *  1. creates mock SKR and ORE mints (unless SKR_MINT / ORE_MINT are set) and mints test tokens to your wallet
 *  2. initialises the Gali config and its token accounts: for each of SKR and ORE a staking vault,
 *     a treasury and a Motherlode Pool
 *  3. on that first run, optionally seeds the pools: MOTHERLODE_SEED (whole SKR) and ORE_SEED (whole ORE)
 *  4. writes app/src/chain/deployment.json for the mobile app
 *
 * ORE's program and mint only exist on mainnet, so devnet gets a mock ORE mint. It stands in for ORE
 * in gear sales, staking and the ORE Motherlode Pool.
 */
import * as anchor from '@coral-xyz/anchor';
import { createMint, getMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, SystemProgram } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { BASE_POINTS, BOOST_TIERS, GEAR, MOTHERLODE_POINTS, MOTHERLODE_POOL_SHARE, SKR_USD } from '../app/src/game/constants';
import { pda, program, PROGRAM_ID } from './common';

const BPF_UPGRADEABLE_LOADER = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');

/** Mock mint decimals: SKR's the app assumes, and ORE's real 11. */
const SKR_DECIMALS = 6;
const ORE_DECIMALS = 11;
/** A stand-in rate for the mock ORE mint. Set real rates in the admin page (Settings, Token prices). */
const ORE_USD = Number(process.env.ORE_USD ?? 61);
/** 0 never refuses a stale price, which suits mock tokens nobody quotes. Set a max age on mainnet. */
const PRICE_MAX_AGE_SECS = Number(process.env.PRICE_MAX_AGE_SECS ?? 0);

/** Whole tokens to raw units, through a decimal string so 11-decimal ORE doesn't lose precision. */
const units = (whole: number, decimals: number) => new anchor.BN(whole.toFixed(decimals).replace('.', ''));
/** The program prices in millionths of a dollar. */
const micro = (dollars: number) => new anchor.BN(Math.round(dollars * 1_000_000));

/** gear_prices_usd[id], from the app's shop list (whole-SKR prices at SKR_USD). */
function gearPricesUsd() {
  const prices = new Array<number>(Math.max(...GEAR.map((g) => g.id)) + 1).fill(0);
  for (const g of GEAR) prices[g.id] = g.priceSkr * SKR_USD;
  return prices.map(micro);
}

async function mockMint(conn: Connection, payer: Keypair, name: string, decimals: number, supply: number) {
  const mint = await createMint(conn, payer, payer.publicKey, null, decimals);
  const ata = await getOrCreateAssociatedTokenAccount(conn, payer, mint, payer.publicKey);
  await mintTo(conn, payer, mint, ata.address, payer, BigInt(supply) * 10n ** BigInt(decimals));
  console.log(`mock ${name} mint`, mint.toBase58(), `(${supply.toLocaleString()} minted to wallet)`);
  return mint;
}

async function main() {
  const { provider, program: gali, wallet } = program();
  const conn = provider.connection;
  console.log('wallet', wallet.publicKey.toBase58(), 'program', PROGRAM_ID.toBase58());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await (gali.account as any).config.fetchNullable(pda.config());
  // an existing config fixes the mints; otherwise take them from the env or make mock ones
  const skrMint: PublicKey =
    existing?.skrMint ?? (process.env.SKR_MINT ? new PublicKey(process.env.SKR_MINT) : await mockMint(conn, wallet.payer, 'SKR', SKR_DECIMALS, 10_000_000));
  const oreMint: PublicKey =
    existing?.oreMint ?? (process.env.ORE_MINT ? new PublicKey(process.env.ORE_MINT) : await mockMint(conn, wallet.payer, 'ORE', ORE_DECIMALS, 10_000));
  const [skrDecimals, oreDecimals] = (await Promise.all([getMint(conn, skrMint), getMint(conn, oreMint)])).map((m) => m.decimals);
  const skr = (n: number) => units(n, skrDecimals);
  const ore = (n: number) => units(n, oreDecimals);

  if (existing) {
    console.log('config already exists');
  } else {
    const sig = await gali.methods
      .initConfig({
        basePoints: new anchor.BN(BASE_POINTS),
        motherlodePoints: new anchor.BN(MOTHERLODE_POINTS),
        boostTier1: skr(BOOST_TIERS[1].min),
        boostTier2: skr(BOOST_TIERS[2].min),
        oreBoostTier1: ore(1),
        oreBoostTier2: ore(10),
        gearPricesUsd: gearPricesUsd(),
        skrPriceMicro: micro(SKR_USD),
        orePriceMicro: micro(ORE_USD),
        priceMaxAgeSecs: PRICE_MAX_AGE_SECS,
        motherlodePoolBps: Math.round(MOTHERLODE_POOL_SHARE * 10_000), // the rest of each SKR sale is treasury
        oreMotherlodeBps: 5_000, // half of each ORE sale to the ORE pool, half to the ORE treasury
      })
      .accountsStrict({
        authority: wallet.publicKey, // must be the program's upgrade authority
        program: PROGRAM_ID,
        programData: PublicKey.findProgramAddressSync([PROGRAM_ID.toBuffer()], BPF_UPGRADEABLE_LOADER)[0],
        config: pda.config(),
        skrMint,
        vault: pda.vault(),
        treasury: pda.treasury(),
        motherlode: pda.motherlode(),
        oreMint,
        oreVault: pda.oreVault(),
        oreTreasury: pda.oreTreasury(),
        oreMotherlode: pda.oreMotherlode(),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('config initialised', sig);

    // both pools start empty and fill from gear sales unless seeded here
    const skrSeed = Number(process.env.MOTHERLODE_SEED ?? 0);
    if (skrSeed > 0) {
      const funderAta = (await getOrCreateAssociatedTokenAccount(conn, wallet.payer, skrMint, wallet.publicKey)).address;
      await gali.methods
        .fundMotherlode(skr(skrSeed))
        .accountsStrict({ funder: wallet.publicKey, config: pda.config(), skrMint, funderAta, motherlode: pda.motherlode(), tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      console.log(`SKR Motherlode Pool seeded with ${skrSeed} SKR`);
    }
    const oreSeed = Number(process.env.ORE_SEED ?? 0);
    if (oreSeed > 0) {
      const funderAta = (await getOrCreateAssociatedTokenAccount(conn, wallet.payer, oreMint, wallet.publicKey)).address;
      await gali.methods
        .fundOre(ore(oreSeed))
        .accountsStrict({ funder: wallet.publicKey, config: pda.config(), oreMint, funderAta, oreMotherlode: pda.oreMotherlode(), tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      console.log(`ORE Motherlode Pool seeded with ${oreSeed} ORE`);
    }
  }

  const out = path.join(__dirname, '../app/src/chain/deployment.json');
  fs.writeFileSync(
    out,
    JSON.stringify({ cluster: 'devnet', programId: PROGRAM_ID.toBase58(), skrMint: skrMint.toBase58(), skrDecimals }, null, 2),
  );
  console.log('wrote', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
