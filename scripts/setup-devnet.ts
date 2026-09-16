/**
 * One-time devnet setup:
 *  1. creates a mock SKR mint (unless SKR_MINT is set) and mints test SKR to your wallet
 *  2. initialises the Gali config, SKR vault and treasury
 *  3. writes app/src/chain/deployment.json for the mobile app
 */
import * as anchor from '@coral-xyz/anchor';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';
import { pda, program, PROGRAM_ID } from './common';

const DECIMALS = 6;
const skr = (n: number) => new anchor.BN(n).mul(new anchor.BN(10).pow(new anchor.BN(DECIMALS)));

async function main() {
  const { provider, program: gali, wallet } = program();
  const conn = provider.connection;
  console.log('wallet', wallet.publicKey.toBase58(), 'program', PROGRAM_ID.toBase58());

  let mint: PublicKey;
  if (process.env.SKR_MINT) {
    mint = new PublicKey(process.env.SKR_MINT);
  } else {
    mint = await createMint(conn, wallet.payer, wallet.publicKey, null, DECIMALS);
    const ata = await getOrCreateAssociatedTokenAccount(conn, wallet.payer, mint, wallet.publicKey);
    await mintTo(conn, wallet.payer, mint, ata.address, wallet.payer, BigInt(1_000_000) * 10n ** BigInt(DECIMALS));
    console.log('mock SKR mint', mint.toBase58(), '(1,000,000 minted to wallet)');
  }

  const existing = await conn.getAccountInfo(pda.config());
  if (!existing) {
    const sig = await gali.methods
      .initConfig({
        roundSecs: 60,
        dailyFreeDigs: 30,
        basePoints: new anchor.BN(40),
        motherlodePoints: new anchor.BN(10_000),
        boostTier1: skr(1_000),
        boostTier2: skr(10_000),
        // item ids match app/src/game/constants.ts GEAR order
        gearPrices: [0, 50, 200, 500, 1200, 0, 80, 300, 2000].map(skr),
      })
      .accountsStrict({
        authority: wallet.publicKey,
        config: pda.config(),
        skrMint: mint,
        vault: pda.vault(),
        treasury: pda.treasury(),
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log('config initialised', sig);
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
