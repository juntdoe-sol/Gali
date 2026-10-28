import { AnchorProvider, BN, Program, type Idl } from '@coral-xyz/anchor';
import { createAssociatedTokenAccountIdempotentInstruction, getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import type { AnchorWallet } from '@solana/wallet-adapter-react';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import idlJson from '../../target/idl/gali.json';

export const RPC_URL = import.meta.env.VITE_RPC_URL ?? 'https://api.devnet.solana.com';
export const CLUSTER = import.meta.env.VITE_CLUSTER ?? 'devnet';
export const connection = new Connection(RPC_URL, { commitment: 'confirmed', disableRetryOnRateLimit: true });
export const PROGRAM_ID = new PublicKey(idlJson.address);

const readOnly = { publicKey: Keypair.generate().publicKey, signTransaction: async <T>(t: T) => t, signAllTransactions: async <T>(t: T[]) => t };
export const programFor = (wallet?: AnchorWallet | null) =>
  new Program(idlJson as Idl, new AnchorProvider(connection, (wallet ?? readOnly) as AnchorWallet, { commitment: 'confirmed' }));
const reader = programFor();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accounts = reader.account as any;

/* ---------- addresses ---------- */
const find = (seed: string) => PublicKey.findProgramAddressSync([new TextEncoder().encode(seed)], PROGRAM_ID)[0];
export const pda = {
  config: find('config'),
  skrVault: find('vault'),
  skrTreasury: find('treasury'),
  skrMotherlode: find('motherlode'),
  oreVault: find('ore_vault'),
  oreTreasury: find('ore_treasury'),
  oreMotherlode: find('ore_motherlode'),
};

/* ---------- reads ---------- */
export type Token = 'SKR' | 'ORE';
export const TOKENS: Token[] = ['SKR', 'ORE'];

const num = (v: BN | number) => (typeof v === 'number' ? v : Number(v.toString()));
export const sol = (lamports: BN | number) => num(lamports) / LAMPORTS_PER_SOL;
/** The program keeps prices in millionths of a dollar. */
const usd = (micro: BN | number) => num(micro) / 1_000_000;

export interface Config {
  authority: string;
  pendingAuthority: string | null;
  paused: boolean;
  mint: Record<Token, PublicKey>;
  decimals: Record<Token, number>;
  /** dollars for one whole token */
  priceUsd: Record<Token, number>;
  /** unix seconds */
  priceUpdatedAt: number;
  /** 0 means gear sales never refuse a stale price */
  priceMaxAgeSecs: number;
  /** whole tokens staked for the 1.25x and 1.5x point boosts */
  boostTier1: Record<Token, number>;
  boostTier2: Record<Token, number>;
  /** share of gear sales sent to each token's motherlode pool; the rest is treasury */
  motherlodeBps: Record<Token, number>;
  basePoints: number;
  motherlodePoints: number;
  gearPricesUsd: number[];
}

async function mintDecimals(mint: PublicKey): Promise<number> {
  const info = await connection.getParsedAccountInfo(mint);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const decimals = (info.value?.data as any)?.parsed?.info?.decimals;
  if (typeof decimals !== 'number') throw new Error(`Could not read the mint ${mint.toBase58()}`);
  return decimals;
}

export async function fetchConfig(): Promise<Config | null> {
  const c = await accounts.config.fetchNullable(pda.config);
  if (!c) return null;
  const [skrDecimals, oreDecimals] = await Promise.all([mintDecimals(c.skrMint), mintDecimals(c.oreMint)]);
  const whole = (v: BN, decimals: number) => num(v) / 10 ** decimals;
  const pending = c.pendingAuthority.toBase58();
  return {
    authority: c.authority.toBase58(),
    pendingAuthority: pending === PublicKey.default.toBase58() ? null : pending,
    paused: c.paused,
    mint: { SKR: c.skrMint, ORE: c.oreMint },
    decimals: { SKR: skrDecimals, ORE: oreDecimals },
    priceUsd: { SKR: usd(c.skrPriceMicro), ORE: usd(c.orePriceMicro) },
    priceUpdatedAt: num(c.priceUpdatedAt),
    priceMaxAgeSecs: c.priceMaxAgeSecs,
    boostTier1: { SKR: whole(c.boostTier1, skrDecimals), ORE: whole(c.oreBoostTier1, oreDecimals) },
    boostTier2: { SKR: whole(c.boostTier2, skrDecimals), ORE: whole(c.oreBoostTier2, oreDecimals) },
    motherlodeBps: { SKR: c.motherlodePoolBps, ORE: c.oreMotherlodeBps },
    basePoints: num(c.basePoints),
    motherlodePoints: num(c.motherlodePoints),
    gearPricesUsd: c.gearPricesUsd.map(usd),
  };
}

/** Seconds since the token prices were set, and whether gear sales are refusing them. */
export function priceAge(cfg: Config) {
  const secs = Math.max(0, Math.floor(Date.now() / 1000) - cfg.priceUpdatedAt);
  return { secs, stale: cfg.priceMaxAgeSecs > 0 && secs > cfg.priceMaxAgeSecs };
}

const tokenBalance = async (k: PublicKey) => {
  try {
    return Number((await connection.getTokenAccountBalance(k)).value.uiAmount ?? 0);
  } catch {
    return 0;
  }
};

export interface Balances {
  treasury: Record<Token, number>;
  motherlode: Record<Token, number>;
  staked: Record<Token, number>;
  authoritySol: number;
}
export async function fetchBalances(authority: string): Promise<Balances> {
  const [skrTreasury, oreTreasury, skrMotherlode, oreMotherlode, skrStaked, oreStaked, authoritySol] = await Promise.all([
    tokenBalance(pda.skrTreasury),
    tokenBalance(pda.oreTreasury),
    tokenBalance(pda.skrMotherlode),
    tokenBalance(pda.oreMotherlode),
    tokenBalance(pda.skrVault),
    tokenBalance(pda.oreVault),
    connection.getBalance(new PublicKey(authority)).then(sol),
  ]);
  return {
    treasury: { SKR: skrTreasury, ORE: oreTreasury },
    motherlode: { SKR: skrMotherlode, ORE: oreMotherlode },
    staked: { SKR: skrStaked, ORE: oreStaked },
    authoritySol,
  };
}

export interface PlayerRow {
  owner: string;
  points: number;
  xp: number;
  wins: number;
  rounds: number;
  /** UTC day of the last recorded round */
  day: number;
  streak: number;
  gearOwned: number;
  stakedSkr: number;
  stakedOre: number;
  solDeployed: number;
  /** jackpot payouts: SKR from the SKR pool, ORE from the ORE pool */
  skrWon: number;
  oreWon: number;
  lastOreRound: number;
}
const bitCount = (n: number) => n.toString(2).replace(/0/g, '').length;

export async function fetchPlayers(cfg: Config): Promise<PlayerRow[]> {
  // only current-layout players; older ones have a shorter account and can't be decoded
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: { account: any }[] = await accounts.player.all([{ dataSize: accounts.player.size }]);
  const skr = (v: BN) => num(v) / 10 ** cfg.decimals.SKR;
  const ore = (v: BN) => num(v) / 10 ** cfg.decimals.ORE;
  return all
    .map(({ account: p }) => ({
      owner: p.owner.toBase58(),
      points: num(p.points),
      xp: num(p.xp),
      wins: p.wins,
      rounds: p.rounds,
      day: p.day,
      streak: p.streak,
      gearOwned: bitCount(p.gearMask),
      stakedSkr: skr(p.stakedSkr),
      stakedOre: ore(p.stakedOre),
      solDeployed: sol(p.solDeployed),
      skrWon: skr(p.skrWon),
      oreWon: ore(p.oreMined),
      lastOreRound: num(p.lastOreRound),
    }))
    .sort((a, b) => b.points - a.points);
}

export const walletBalance = (cfg: Config, token: Token, owner: PublicKey) =>
  tokenBalance(getAssociatedTokenAddressSync(cfg.mint[token], owner));

/* ---------- writes (signed by the connected wallet) ---------- */
/** Whole tokens to raw units, through a decimal string so 11-decimal ORE doesn't lose precision. */
const raw = (whole: number, decimals: number) => new BN(whole.toFixed(decimals).replace('.', ''));
const micro = (dollars: number) => new BN(Math.round(dollars * 1_000_000));
const admin = (wallet: AnchorWallet) => ({ authority: wallet.publicKey, config: pda.config });

export const setTokenPrices = (wallet: AnchorWallet, skrUsd: number, oreUsd: number) =>
  programFor(wallet).methods.setTokenPrices(micro(skrUsd), micro(oreUsd)).accountsStrict(admin(wallet)).rpc();

/** Fields left undefined stay as they are on-chain. Token amounts are whole tokens, prices dollars. */
export interface ConfigChange {
  basePoints?: number;
  motherlodePoints?: number;
  boostTier1Skr?: number;
  boostTier2Skr?: number;
  boostTier1Ore?: number;
  boostTier2Ore?: number;
  motherlodePct?: number;
  oreMotherlodePct?: number;
  priceMaxAgeSecs?: number;
  gearPricesUsd?: number[];
}

export function updateConfig(wallet: AnchorWallet, cfg: Config, ch: ConfigChange) {
  // ConfigUpdate is a struct of Options, so every field goes on the wire and null means "keep"
  const opt = <T, R>(v: T | undefined, f: (v: T) => R) => (v === undefined ? null : f(v));
  const bps = (pct: number) => Math.round(pct * 100);
  const skr = (v: number) => raw(v, cfg.decimals.SKR);
  const ore = (v: number) => raw(v, cfg.decimals.ORE);
  return programFor(wallet)
    .methods.updateConfig({
      basePoints: opt(ch.basePoints, (v) => new BN(v)),
      motherlodePoints: opt(ch.motherlodePoints, (v) => new BN(v)),
      boostTier1: opt(ch.boostTier1Skr, skr),
      boostTier2: opt(ch.boostTier2Skr, skr),
      oreBoostTier1: opt(ch.boostTier1Ore, ore),
      oreBoostTier2: opt(ch.boostTier2Ore, ore),
      gearPricesUsd: opt(ch.gearPricesUsd, (v) => v.map(micro)),
      priceMaxAgeSecs: opt(ch.priceMaxAgeSecs, (v) => v),
      motherlodePoolBps: opt(ch.motherlodePct, bps),
      oreMotherlodeBps: opt(ch.oreMotherlodePct, bps),
    })
    .accountsStrict(admin(wallet))
    .rpc();
}

export const setPaused = (wallet: AnchorWallet, paused: boolean) =>
  programFor(wallet).methods.setPaused(paused).accountsStrict(admin(wallet)).rpc();

export const proposeAuthority = (wallet: AnchorWallet, next: PublicKey) =>
  programFor(wallet).methods.proposeAuthority(next).accountsStrict(admin(wallet)).rpc();

export const acceptAuthority = (wallet: AnchorWallet) =>
  programFor(wallet).methods.acceptAuthority().accountsStrict({ newAuthority: wallet.publicKey, config: pda.config }).rpc();

/** Withdraw treasury SKR or ORE to `owner`'s token account for that mint (created if missing). */
export function withdrawTreasury(wallet: AnchorWallet, cfg: Config, token: Token, owner: PublicKey, amount: number) {
  const mint = cfg.mint[token];
  const destination = getAssociatedTokenAddressSync(mint, owner, true);
  const createDestination = createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, destination, owner, mint);
  const methods = programFor(wallet).methods;
  const common = { authority: wallet.publicKey, config: pda.config, destination, tokenProgram: TOKEN_PROGRAM_ID };
  const call =
    token === 'SKR'
      ? methods.withdrawTreasury(raw(amount, cfg.decimals.SKR)).accountsStrict({ ...common, skrMint: mint, treasury: pda.skrTreasury })
      : methods.withdrawTreasuryOre(raw(amount, cfg.decimals.ORE)).accountsStrict({ ...common, oreMint: mint, oreTreasury: pda.oreTreasury });
  return call.preInstructions([createDestination]).rpc();
}

/** Add SKR or ORE from the connected wallet to that token's motherlode pool. Anyone may. */
export function fundMotherlode(wallet: AnchorWallet, cfg: Config, token: Token, amount: number) {
  const mint = cfg.mint[token];
  const methods = programFor(wallet).methods;
  const common = { funder: wallet.publicKey, config: pda.config, funderAta: getAssociatedTokenAddressSync(mint, wallet.publicKey), tokenProgram: TOKEN_PROGRAM_ID };
  const call =
    token === 'SKR'
      ? methods.fundMotherlode(raw(amount, cfg.decimals.SKR)).accountsStrict({ ...common, skrMint: mint, motherlode: pda.skrMotherlode })
      : methods.fundOre(raw(amount, cfg.decimals.ORE)).accountsStrict({ ...common, oreMint: mint, oreMotherlode: pda.oreMotherlode });
  return call.rpc();
}

export const explorerAddr = (a: string) => `https://explorer.solana.com/address/${a}?cluster=${CLUSTER === 'mainnet-beta' ? '' : CLUSTER}`;
export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
