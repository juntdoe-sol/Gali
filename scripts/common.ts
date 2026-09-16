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
  dig: (owner: PublicKey, round: number | bigint) =>
    PublicKey.findProgramAddressSync([Buffer.from('dig'), owner.toBuffer(), u64le(round)], PROGRAM_ID)[0],
  round: (round: number | bigint) => PublicKey.findProgramAddressSync([Buffer.from('round'), u64le(round)], PROGRAM_ID)[0],
  pot: (round: number | bigint) => PublicKey.findProgramAddressSync([Buffer.from('pot'), u64le(round)], PROGRAM_ID)[0],
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
