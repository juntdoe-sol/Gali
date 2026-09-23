import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import idl from '../target/idl/gali.json';

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
export const u64le = (n: number | bigint) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
};
export const pda = {
  config: () => PublicKey.findProgramAddressSync([Buffer.from('config')], PROGRAM_ID)[0],
  vault: () => PublicKey.findProgramAddressSync([Buffer.from('vault')], PROGRAM_ID)[0],
  treasury: () => PublicKey.findProgramAddressSync([Buffer.from('treasury')], PROGRAM_ID)[0],
  motherlode: () => PublicKey.findProgramAddressSync([Buffer.from('motherlode')], PROGRAM_ID)[0],
  rewards: () => PublicKey.findProgramAddressSync([Buffer.from('rewards')], PROGRAM_ID)[0],
  potVault: () => PublicKey.findProgramAddressSync([Buffer.from('pot_vault')], PROGRAM_ID)[0],
  player: (owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('player'), owner.toBuffer()], PROGRAM_ID)[0],
  stake: (owner: PublicKey, round: number | bigint) =>
    PublicKey.findProgramAddressSync([Buffer.from('stake'), owner.toBuffer(), u64le(round)], PROGRAM_ID)[0],
  draw: (round: number | bigint) => PublicKey.findProgramAddressSync([Buffer.from('draw'), u64le(round)], PROGRAM_ID)[0],
  round: (round: number | bigint) => PublicKey.findProgramAddressSync([Buffer.from('round'), u64le(round)], PROGRAM_ID)[0],
  pot: (round: number | bigint) => PublicKey.findProgramAddressSync([Buffer.from('pot'), u64le(round)], PROGRAM_ID)[0],
  buyback: () => PublicKey.findProgramAddressSync([Buffer.from('buyback')], PROGRAM_ID)[0],
  refinery: () => PublicKey.findProgramAddressSync([Buffer.from('refinery')], PROGRAM_ID)[0],
  unclaimed: (owner: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from('unclaimed'), owner.toBuffer()], PROGRAM_ID)[0],
};

export function loadWallet(): Keypair {
  const p = process.env.ANCHOR_WALLET ?? path.join(os.homedir(), '.config/solana/id.json');
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, 'utf8'))));
}

export function program(rpc = process.env.RPC_URL ?? 'https://api.devnet.solana.com') {
  const connection = new Connection(rpc, 'confirmed');
  const wallet = new anchor.Wallet(loadWallet());
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  anchor.setProvider(provider);
  return { provider, program: new anchor.Program(idl as anchor.Idl, provider), wallet };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reveal a finished round the tamper-proof way: `lock_round` commits to a slot a couple of slots
 * ahead, then `reveal_round` uses that slot's hash once it exists. Safe to race with other callers.
 */
export async function lockAndReveal(gali: anchor.Program, payer: PublicKey, round: number) {
  const connection = gali.provider.connection;
  const lock = () =>
    gali.methods
      .lockRound(new anchor.BN(round))
      .accountsStrict({ payer, config: pda.config(), draw: pda.draw(round), round: pda.round(round), systemProgram: anchor.web3.SystemProgram.programId })
      .rpc()
      .catch(() => undefined); // already locked (or revealed) by someone else
  for (let i = 0; i < 30; i++) {
    if (await connection.getAccountInfo(pda.round(round))) return;
    if (!(await connection.getAccountInfo(pda.draw(round)))) {
      await lock();
      continue;
    }
    try {
      await gali.methods
        .revealRound(new anchor.BN(round))
        .accountsStrict({
          payer,
          config: pda.config(),
          round: pda.round(round),
          draw: pda.draw(round),
          slotHashes: anchor.web3.SYSVAR_SLOT_HASHES_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      return;
    } catch (e) {
      if (/DrawExpired/.test(String(e))) await lock();
      await sleep(500); // the locked slot hasn't passed yet
    }
  }
  throw new Error(`could not reveal round ${round}`);
}
