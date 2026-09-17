import { AnchorProvider, BN, Program, type Idl } from '@coral-xyz/anchor';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, SYSVAR_SLOT_HASHES_PUBKEY, type TransactionInstruction } from '@solana/web3.js';
import idlJson from '../../target/idl/gali.json';

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
export const CLUSTER = import.meta.env.VITE_CLUSTER ?? 'devnet';
export const connection = new Connection(RPC_URL, 'confirmed');
export const PROGRAM_ID = new PublicKey(idlJson.address);

const readOnly = { publicKey: Keypair.generate().publicKey, signTransaction: async <T>(t: T) => t, signAllTransactions: async <T>(t: T[]) => t };
export const programFor = (wallet?: AnchorWallet | null) =>
  new Program(idlJson as Idl, new AnchorProvider(connection, (wallet ?? readOnly) as AnchorWallet, { commitment: 'confirmed' }));
const reader = programFor();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accounts = reader.account as any;

/* ---------- addresses ---------- */
const u64le = (n: number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const find = (...seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
const enc = (s: string) => new TextEncoder().encode(s);
export const pda = {
  config: find(enc('config')),
  vault: find(enc('vault')),
  treasury: find(enc('treasury')),
  motherlode: find(enc('motherlode')),
  rewards: find(enc('rewards')),
  potVault: find(enc('pot_vault')),
  round: (r: number) => find(enc('round'), u64le(r)),
  pot: (r: number) => find(enc('pot'), u64le(r)),
  draw: (r: number) => find(enc('draw'), u64le(r)),
};

/* ---------- reads ---------- */
const num = (v: BN | number) => (typeof v === 'number' ? v : Number(v.toString()));
export const sol = (lamports: BN | number) => num(lamports) / LAMPORTS_PER_SOL;

export interface Config {
  authority: string;
  pendingAuthority: string | null;
  skrMint: PublicKey;
  decimals: number;
  roundSecs: number;
  paused: boolean;
  potFeeBps: number;
  motherlodePoolBps: number;
  rewardsPoolBps: number;
  minDeploySol: number;
  roundRewardSkr: number;
  motherlodeSkr: number;
  basePoints: number;
  motherlodePoints: number;
  boostTier1Skr: number;
  boostTier2Skr: number;
  gearPricesSkr: number[];
  dripBps: number;
  buybackBps: number;
  buybackDueSol: number;
}

export async function fetchConfig(): Promise<Config | null> {
  const c = await accounts.config.fetchNullable(pda.config);
  if (!c) return null;
  const mint = await connection.getParsedAccountInfo(c.skrMint);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decimals: number = (mint.value?.data as any)?.parsed?.info?.decimals ?? 6;
  const skr = (v: BN) => num(v) / 10 ** decimals;
  const pending = c.pendingAuthority.toBase58();
  return {
    authority: c.authority.toBase58(),
    pendingAuthority: pending === PublicKey.default.toBase58() ? null : pending,
    skrMint: c.skrMint,
    decimals,
    roundSecs: c.roundSecs,
    paused: c.paused,
    potFeeBps: c.potFeeBps,
    motherlodePoolBps: c.motherlodePoolBps,
    rewardsPoolBps: c.rewardsPoolBps,
    minDeploySol: sol(c.minDeploy),
    roundRewardSkr: skr(c.roundRewardSkr),
    motherlodeSkr: skr(c.motherlodeSkr),
    basePoints: num(c.basePoints),
    motherlodePoints: num(c.motherlodePoints),
    boostTier1Skr: skr(c.boostTier1),
    boostTier2Skr: skr(c.boostTier2),
    gearPricesSkr: c.gearPrices.map(skr),
    dripBps: c.rewardDripBps,
    buybackBps: c.buybackBps,
    buybackDueSol: sol(c.buybackDue),
  };
}

const tokenBalance = async (k: PublicKey) => {
  try {
    return Number((await connection.getTokenAccountBalance(k)).value.uiAmount ?? 0);
  } catch {
    return 0;
  }
};

export interface Balances {
  treasury: number;
  rewards: number;
  motherlode: number;
  potEscrow: number;
  staked: number;
  authoritySol: number;
}
export async function fetchBalances(authority: string): Promise<Balances> {
  const [treasury, rewards, motherlode, potEscrow, staked, authoritySol] = await Promise.all([
    tokenBalance(pda.treasury),
    tokenBalance(pda.rewards),
    tokenBalance(pda.motherlode),
    tokenBalance(pda.potVault),
    tokenBalance(pda.vault),
    connection.getBalance(new PublicKey(authority)).then(sol),
  ]);
  return { treasury, rewards, motherlode, potEscrow, staked, authoritySol };
}

export interface PotRow {
  roundId: number;
  totalSol: number;
  poolSol: number;
  feeSol: number;
  skrReward: number;
  miners: number;
  settled: boolean;
  motherlode: boolean;
  splitReward: boolean;
  motherlodePaid: number;
  winner: string | null;
}
export async function fetchPots(decimals: number): Promise<PotRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: { account: any }[] = await accounts.pot.all();
  return all
    .map(({ account: p }) => ({
      roundId: num(p.roundId),
      totalSol: sol(p.total),
      poolSol: sol(p.pool),
      feeSol: p.settled ? sol(p.adminFee) + sol(p.protocolFee) : 0,
      skrReward: num(p.skrReward) / 10 ** decimals,
      miners: p.miners,
      settled: p.settled,
      motherlode: p.motherlode,
      splitReward: p.splitReward,
      motherlodePaid: num(p.motherlodeSkr) / 10 ** decimals,
      winner: p.winner.equals(PublicKey.default) ? null : p.winner.toBase58(),
    }))
    .sort((a, b) => b.roundId - a.roundId);
}

export interface PlayerRow {
  owner: string;
  points: number;
  wins: number;
  rounds: number;
  day: number;
  streak: number;
  stakedSkr: number;
  solDeployed: number;
  solWon: number;
  skrMined: number;
  skrWon: number;
}
export async function fetchPlayers(decimals: number): Promise<PlayerRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: { account: any }[] = await accounts.player.all();
  const skr = (v: BN) => num(v) / 10 ** decimals;
  return all
    .map(({ account: p }) => ({
      owner: p.owner.toBase58(),
      points: num(p.points),
      wins: p.wins,
      rounds: p.rounds,
      day: p.day,
      streak: p.streak,
      stakedSkr: skr(p.stakedSkr),
      solDeployed: sol(p.solDeployed),
      solWon: sol(p.solWon),
      skrMined: skr(p.skrMined),
      skrWon: skr(p.skrWon),
    }))
    .sort((a, b) => b.points - a.points);
}

export const roundRevealed = async (r: number) => Boolean(await connection.getAccountInfo(pda.round(r)));

/* ---------- writes (signed by the connected wallet) ---------- */
const raw = (whole: number, decimals: number) => new BN(BigInt(Math.round(whole * 10 ** decimals)).toString());

export interface ConfigChange {
  potFeePct?: number;
  motherlodePoolPct?: number;
  rewardsPoolPct?: number;
  minDeploySol?: number;
  roundRewardSkr?: number;
  motherlodeSkr?: number;
  basePoints?: number;
  motherlodePoints?: number;
  boostTier1Skr?: number;
  boostTier2Skr?: number;
  gearPricesSkr?: number[];
  dripPct?: number;
  buybackPct?: number;
}

export async function updateConfig(wallet: AnchorWallet, cfg: Config, ch: ConfigChange) {
  const d = cfg.decimals;
  const opt = <T>(v: T | undefined) => (v === undefined ? null : v);
  const bps = (pct?: number) => (pct === undefined ? null : Math.round(pct * 100));
  return programFor(wallet)
    .methods.updateConfig({
      basePoints: opt(ch.basePoints === undefined ? undefined : new BN(ch.basePoints)),
      motherlodePoints: opt(ch.motherlodePoints === undefined ? undefined : new BN(ch.motherlodePoints)),
      boostTier1: opt(ch.boostTier1Skr === undefined ? undefined : raw(ch.boostTier1Skr, d)),
      boostTier2: opt(ch.boostTier2Skr === undefined ? undefined : raw(ch.boostTier2Skr, d)),
      gearPrices: opt(ch.gearPricesSkr?.map((p) => raw(p, d))),
      motherlodeSkr: opt(ch.motherlodeSkr === undefined ? undefined : raw(ch.motherlodeSkr, d)),
      motherlodePoolBps: bps(ch.motherlodePoolPct),
      rewardsPoolBps: bps(ch.rewardsPoolPct),
      potFeeBps: bps(ch.potFeePct),
      minDeploy: opt(ch.minDeploySol === undefined ? undefined : new BN(Math.round(ch.minDeploySol * LAMPORTS_PER_SOL))),
      roundRewardSkr: opt(ch.roundRewardSkr === undefined ? undefined : raw(ch.roundRewardSkr, d)),
      rewardDripBps: bps(ch.dripPct),
      buybackBps: bps(ch.buybackPct),
    })
    .accountsStrict({ authority: wallet.publicKey, config: pda.config })
    .rpc();
}

/** Record SOL (from the fees owed to buybacks) that has been spent buying SKR for the Rewards Pool. */
export const markBuyback = (wallet: AnchorWallet, solSpent: number) =>
  programFor(wallet)
    .methods.markBuyback(new BN(Math.round(solSpent * LAMPORTS_PER_SOL)))
    .accountsStrict({ authority: wallet.publicKey, config: pda.config })
    .rpc();

export const setPaused = (wallet: AnchorWallet, paused: boolean) =>
  programFor(wallet).methods.setPaused(paused).accountsStrict({ authority: wallet.publicKey, config: pda.config }).rpc();

export const proposeAuthority = (wallet: AnchorWallet, next: PublicKey) =>
  programFor(wallet).methods.proposeAuthority(next).accountsStrict({ authority: wallet.publicKey, config: pda.config }).rpc();

export const acceptAuthority = (wallet: AnchorWallet) =>
  programFor(wallet).methods.acceptAuthority().accountsStrict({ newAuthority: wallet.publicKey, config: pda.config }).rpc();

/** Withdraw treasury SKR to `owner`'s SKR account (created if missing). */
export async function withdrawTreasury(wallet: AnchorWallet, cfg: Config, owner: PublicKey, amount: number) {
  const dest = getAssociatedTokenAddressSync(cfg.skrMint, owner, true);
  const pre: TransactionInstruction[] = [createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, dest, owner, cfg.skrMint)];
  return programFor(wallet)
    .methods.withdrawTreasury(raw(amount, cfg.decimals))
    .accountsStrict({
      authority: wallet.publicKey,
      config: pda.config,
      skrMint: cfg.skrMint,
      treasury: pda.treasury,
      destination: dest,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .preInstructions(pre)
    .rpc();
}

/** Top up a pool from the connected wallet's SKR. */
export async function fundPool(wallet: AnchorWallet, cfg: Config, pool: 'rewards' | 'motherlode', amount: number) {
  const funderAta = getAssociatedTokenAddressSync(cfg.skrMint, wallet.publicKey);
  const p = programFor(wallet);
  const common = { funder: wallet.publicKey, config: pda.config, skrMint: cfg.skrMint, funderAta, tokenProgram: TOKEN_PROGRAM_ID };
  return pool === 'rewards'
    ? p.methods
        .fundRewards(raw(amount, cfg.decimals))
        .accountsStrict({ ...common, rewards: pda.rewards })
        .rpc()
    : p.methods
        .fundMotherlode(raw(amount, cfg.decimals))
        .accountsStrict({ ...common, motherlode: pda.motherlode })
        .rpc();
}

export const walletSkr = (cfg: Config, owner: PublicKey) => tokenBalance(getAssociatedTokenAddressSync(cfg.skrMint, owner));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Reveal (if needed) and settle a finished round's pot. Anyone may do this; the SOL fee still goes to the authority.
 * Revealing takes two transactions: lock the round to a future slot, then reveal once that slot has passed.
 */
export async function revealAndSettle(wallet: AnchorWallet, cfg: Config, roundId: number) {
  const p = programFor(wallet);
  const lock = () =>
    p.methods
      .lockRound(new BN(roundId))
      .accountsStrict({
        payer: wallet.publicKey,
        config: pda.config,
        draw: pda.draw(roundId),
        round: pda.round(roundId),
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  const settle = () =>
    p.methods.settlePot(new BN(roundId)).accountsStrict({
      config: pda.config,
      round: pda.round(roundId),
      pot: pda.pot(roundId),
      feeTo: new PublicKey(cfg.authority),
      skrMint: cfg.skrMint,
      rewards: pda.rewards,
      motherlode: pda.motherlode,
      potVault: pda.potVault,
      tokenProgram: TOKEN_PROGRAM_ID,
    });
  if (await roundRevealed(roundId)) return settle().rpc();
  if (!(await connection.getAccountInfo(pda.draw(roundId)))) await lock();
  const reveal = await p.methods
    .revealRound(new BN(roundId))
    .accountsStrict({
      payer: wallet.publicKey,
      config: pda.config,
      round: pda.round(roundId),
      draw: pda.draw(roundId),
      slotHashes: SYSVAR_SLOT_HASHES_PUBKEY,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  let last: unknown;
  for (let i = 0; i < 8; i++) {
    await sleep(900); // wait for the locked slot to pass
    if (await roundRevealed(roundId)) return settle().rpc();
    try {
      return await settle().preInstructions([reveal]).rpc();
    } catch (e) {
      last = e;
      if (/DrawExpired/.test(String(e))) await lock();
    }
  }
  throw last;
}

export const explorerTx = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER === 'mainnet-beta' ? '' : CLUSTER}`;
export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER === 'mainnet-beta' ? '' : CLUSTER}`;
export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
export { ASSOCIATED_TOKEN_PROGRAM_ID };
