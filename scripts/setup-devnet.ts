/**
 * One-time devnet setup:
 *  1. creates a mock SKR mint (unless SKR_MINT is set) and mints test SKR to your wallet
 *  2. initialises the Gali config and its SKR accounts (vault, treasury, Motherlode, Rewards, pot escrow)
 *  3. seeds the Motherlode and Rewards Pools with test SKR
 *  4. writes app/src/chain/deployment.json for the mobile app
 */
import * as anchor from '@coral-xyz/anchor';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { pda, program, PROGRAM_ID } from './common';

const DECIMALS = 6;
// Whole-SKR prices by gear id; keep in sync with app/src/game/constants.ts.
// Priced at roughly 1 SKR = $0.018 (55 SKR = $1): the cheapest paid item is ~$3.6, the top one ~$270.
export const GEAR_PRICES = [
  0, 250, 800, 2_000, 5_000, 12_000, // pickaxes 0-5
  0, 300, 1_000, 2_500, 6_000, 15_000, // helmets 6-11
  0, 200, 900, 2_200, 8_000, // outfits 12-16
  500, 1_500, 4_000, 10_000, // pets 17-20
];
const skr = (n: number) => new anchor.BN(n).mul(new anchor.BN(10).pow(new anchor.BN(DECIMALS)));

async function main() {
  const { provider, program: gali, wallet } = program();
  const conn = provider.connection;
  console.log('wallet', wallet.publicKey.toBase58(), 'program', PROGRAM_ID.toBase58());

  let mint: PublicKey;
  const existingCfg = await (gali.account as any).config.fetchNullable(pda.config());
  if (existingCfg) {
    mint = existingCfg.skrMint; // already set up: keep the mint the program uses
  } else if (process.env.SKR_MINT) {
    mint = new PublicKey(process.env.SKR_MINT);
  } else {
    mint = await createMint(conn, wallet.payer, wallet.publicKey, null, DECIMALS);
    const ata = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, mint, wallet.publicKey);
    await mintTo(conn, wallet.payer, mint, ata.address, wallet.payer, BigInt(10_000_000) * 10n ** BigInt(DECIMALS));
    console.log('mock SKR mint', mint.toBase58(), '(10,000,000 minted to wallet)');
  }

  const existing = await conn.getAccountInfo(pda.config());
  if (!existing) {
    const sig = await gali.methods
      .initConfig({
        roundSecs: 60,
        basePoints: new anchor.BN(40),
        motherlodePoints: new anchor.BN(10_000),
        boostTier1: skr(5_000), // ~$90 staked: 1.25x points
        boostTier2: skr(50_000), // ~$900 staked: 1.5x points
        // item ids match app/src/game/constants.ts GEAR ids
        gearPrices: GEAR_PRICES.map(skr),
        motherlodeSkr: skr(5_000), // ~$90 per motherlode winner
        motherlodePoolBps: 3_000, // gear sales: 30% Motherlode Pool
        rewardsPoolBps: 4_000, //              40% Rewards Pool, 30% treasury
        potFeeBps: 1_000, // 10% of each SOL pot goes to the treasury wallet
        minDeploy: new anchor.BN(100_000), // 0.0001 SOL per block
        roundRewardSkr: skr(200), // SKR mined per round: split, or all to one lucky winner
      })
      .accountsStrict({
        authority: wallet.publicKey,
        config: pda.config(),
        skrMint: mint,
        vault: pda.vault(),
        treasury: pda.treasury(),
        motherlode: pda.motherlode(),
        rewards: pda.rewards(),
        potVault: pda.potVault(),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('config initialised', sig);
    // seed the pools with test SKR so the first rounds and motherlodes pay out
    const funderAta = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, mint, wallet.publicKey);
    const mSeed = Number(process.env.MOTHERLODE_SEED ?? 250_000);
    if (mSeed > 0) {
      await gali.methods
        .fundMotherlode(skr(mSeed))
        .accountsStrict({ funder: wallet.publicKey, config: pda.config(), skrMint: mint, funderAta: funderAta.address, motherlode: pda.motherlode(), tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      console.log(`Motherlode Pool seeded with ${mSeed} SKR`);
    }
    const rSeed = Number(process.env.REWARDS_SEED ?? 5_000_000);
    if (rSeed > 0) {
      await gali.methods
        .fundRewards(skr(rSeed))
        .accountsStrict({ funder: wallet.publicKey, config: pda.config(), skrMint: mint, funderAta: funderAta.address, rewards: pda.rewards(), tokenProgram: TOKEN_PROGRAM_ID })
        .rpc();
      console.log(`Rewards Pool seeded with ${rSeed} SKR (${Math.floor(rSeed / 200 / 1440)} days at 200 SKR a round)`);
    }
  } else console.log('config already exists');

  const out = path.join(__dirname, '../app/src/chain/deployment.json');
  fs.writeFileSync(
    out,
    JSON.stringify({ cluster: 'devnet', programId: PROGRAM_ID.toBase58(), skrMint: mint.toBase58(), skrDecimals: DECIMALS }, null, 2),
  );
  console.log('wrote', out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
