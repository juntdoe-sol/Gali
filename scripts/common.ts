import * as anchor from '@coral-xyz/anchor';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import fs from 'fs';
import os from 'os';
import path from 'path';
import idl from '../target/idl/gali.json';

export const PROGRAM_ID = new PublicKey((idl as { address: string }).address);
const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const pda = {
  config: () => find(Buffer.from('config')),
  vault: () => find(Buffer.from('vault')),
  treasury: () => find(Buffer.from('treasury')),
  motherlode: () => find(Buffer.from('motherlode')),
  oreVault: () => find(Buffer.from('ore_vault')),
  oreTreasury: () => find(Buffer.from('ore_treasury')),
  oreMotherlode: () => find(Buffer.from('ore_motherlode')),
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
