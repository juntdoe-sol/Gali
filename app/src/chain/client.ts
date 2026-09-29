import './polyfill-web';
import { AnchorProvider, BN, Program, utils, type Idl } from '@coral-xyz/anchor';
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { ROUND_SECS } from '../game/constants';
import { webConnect, webDisconnect, webOwner, webSign } from './webWallet';
export { listWebWallets, PickWalletError, type WebWalletInfo } from './webWallet';
import idlJson from './idl.json';
import deployment from './deployment.json';
import { CLUSTER, clockOffsetMs, MAX_SESSION_FUND_SOL, PROGRAM_ID_STR, RPC_URL, retryingFetch, SKR_MINT_STR } from './light';

export { CLUSTER, RPC_URL, chainReady, isRateLimited, clockOffsetMs, MAX_SESSION_FUND_SOL, short, explorer } from './light';
// PublicKey for code outside src/chain, which reaches web3 only through this lazily loaded module.
export { PublicKey };
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
export const SKR_MINT = new PublicKey(SKR_MINT_STR);
export const SKR_DECIMALS = deployment.skrDecimals;
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const APP_IDENTITY = { name: 'Gali', uri: 'https://gali.bounded.page', icon: 'favicon.png' };
export const connection = new Connection(RPC_URL, { commitment: 'confirmed', fetch: retryingFetch, disableRetryOnRateLimit: true });
const readOnlyWallet = {
  publicKey: Keypair.generate().publicKey,
  signTransaction: async <T,>(t: T) => t,
  signAllTransactions: async <T,>(t: T[]) => t,
};
const provider = new AnchorProvider(connection, readOnlyWallet as never, { commitment: 'confirmed' });
export const program = new Program(idlJson as Idl, provider);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const accounts = program.account as any;

/* ---------- PDAs ---------- */
const u64le = (n: number) => {
  const b = Buffer.alloc(8);
  new DataView(b.buffer, b.byteOffset, 8).setBigUint64(0, BigInt(n), true);
  return b;
};
const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const pda = {
  config: find(Buffer.from('config')),
  vault: find(Buffer.from('vault')),
  treasury: find(Buffer.from('treasury')),
  motherlode: find(Buffer.from('motherlode')),
  rewards: find(Buffer.from('rewards')),
  potVault: find(Buffer.from('pot_vault')),
  player: (o: PublicKey) => find(Buffer.from('player'), o.toBuffer()),
  round: (r: number) => find(Buffer.from('round'), u64le(r)),
  pot: (r: number) => find(Buffer.from('pot'), u64le(r)),
  stake: (o: PublicKey, r: number) => find(Buffer.from('stake'), o.toBuffer(), u64le(r)),
  draw: (r: number) => find(Buffer.from('draw'), u64le(r)),
  unclaimed: (o: PublicKey) => find(Buffer.from('unclaimed'), o.toBuffer()),
  refinery: find(Buffer.from('refinery')),
  buyback: find(Buffer.from('buyback')),
};
export const ata = (owner: PublicKey, mint = SKR_MINT) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

/* ---------- reads ---------- */
export interface ChainPlayer {
  points: number;
  xp: number;
  wins: number;
  rounds: number;
  day: number;
  streak: number;
  stakedSkr: number; // whole SKR
  gearMask: number;
  session: string;
  sessionExpires: number;
  skrWon: number; // whole SKR won from the Motherlode Pool
  solDeployed: number; // SOL
  solWon: number; // SOL
  skrMined: number; // whole SKR mined from rounds
}
const toNum = (v: BN | number) => (typeof v === 'number' ? v : Number(v.toString()));
const fromRaw = (v: BN | number) => toNum(v) / 10 ** SKR_DECIMALS;

export async function fetchPlayer(owner: PublicKey): Promise<ChainPlayer | null> {
  const p = await accounts.player.fetchNullable(pda.player(owner));
  if (!p) return null;
  return {
    points: toNum(p.points),
    xp: toNum(p.xp),
    wins: p.wins,
    rounds: p.rounds,
    day: p.day,
    streak: p.streak,
    stakedSkr: fromRaw(p.stakedSkr),
    gearMask: p.gearMask,
    session: p.session.toBase58(),
    sessionExpires: toNum(p.sessionExpires),
    skrWon: fromRaw(p.skrWon),
    solDeployed: toNum(p.solDeployed) / LAMPORTS_PER_SOL,
    solWon: toNum(p.solWon) / LAMPORTS_PER_SOL,
    skrMined: fromRaw(p.skrMined),
  };
}

export interface Economy {
  roundReward: number; // whole SKR cap
  motherlodeTopUp: number; // whole SKR cap
  dripBps: number;
  buybackBps: number;
  potFeeBps: number;
}
export async function fetchEconomy(): Promise<Economy> {
  const c = await accounts.config.fetch(pda.config);
  return {
    roundReward: fromRaw(c.roundRewardSkr),
    motherlodeTopUp: fromRaw(c.motherlodeSkr),
    dripBps: c.rewardDripBps,
    buybackBps: c.buybackBps,
    potFeeBps: c.potFeeBps,
  };
}
/** SKR the next round mines, given the Rewards Pool balance (settle_pot's budget). */
export function roundRewardNow(e: Economy, rewardsPool: number) {
  const cap = e.roundReward + e.motherlodeTopUp;
  if (cap <= 0) return 0;
  const budget = e.dripBps > 0 ? Math.min(cap, (rewardsPool * e.dripBps) / 10_000) : cap;
  return Math.min(rewardsPool, (budget * e.roundReward) / cap);
}

export const CLAIM_SOL = 1;
export const CLAIM_SKR = 2;
const claimRewardsIx = (owner: PublicKey, what: number) =>
  program.methods
    .claimRewards(what)
    .accountsStrict({
      owner,
      config: pda.config,
      player: pda.player(owner),
      unclaimed: pda.unclaimed(owner),
      refinery: pda.refinery,
      skrMint: SKR_MINT,
      potVault: pda.potVault,
      rewards: pda.rewards,
      ownerAta: ata(owner),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
/** Send the leftover SOL on the session key back to the wallet (keeps enough for one fee). */
export async function sweepSession(owner: PublicKey, session: Keypair) {
  const balance = await connection.getBalance(session.publicKey);
  const amount = balance - 5_000;
  if (amount <= 0) throw new Error('the session key is already empty');
  await sendWithKey(session, [SystemProgram.transfer({ fromPubkey: session.publicKey, toPubkey: owner, lamports: amount })]);
  return amount / LAMPORTS_PER_SOL;
}
let feeTo: { at: number; key: PublicKey } | null = null;
async function configAuthority() {
  if (!feeTo || Date.now() - feeTo.at > 60_000) feeTo = { at: Date.now(), key: (await accounts.config.fetch(pda.config)).authority };
  return feeTo.key;
}

export async function fetchSkrBalance(owner: PublicKey): Promise<number> {
  try {
    const b = await connection.getTokenAccountBalance(ata(owner));
    return Number(b.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

/** Current SKR in the Rewards Pool (whole SKR). */
export async function fetchRewardsPool(): Promise<number> {
  try {
    const b = await connection.getTokenAccountBalance(pda.rewards);
    return Number(b.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

/** Current SKR in the Motherlode Pool (whole SKR). */
export async function fetchMotherlodePool(): Promise<number> {
  try {
    const b = await connection.getTokenAccountBalance(pda.motherlode);
    return Number(b.value.uiAmount ?? 0);
  } catch {
    return 0;
  }
}

export const fetchSolBalance = async (k: PublicKey) => (await connection.getBalance(k)) / LAMPORTS_PER_SOL;

export interface LeaderRow {
  owner: string;
  points: number;
  wins: number;
  level: number;
}
let board: { at: number; rows: LeaderRow[] } | null = null;
/** Top 25 by points. Reads only the first 60 bytes of each Player account and caches for a minute. */
export async function fetchLeaderboard(): Promise<LeaderRow[]> {
  if (board && Date.now() - board.at < 60_000) return board.rows;
  const raw = await connection.getProgramAccounts(PROGRAM_ID, {
    dataSlice: { offset: 0, length: 60 }, // discriminator | owner | points | xp | wins
    filters: [{ memcmp: { offset: 0, bytes: utils.bytes.bs58.encode(Buffer.from(playerDisc)) } }],
  });
  const rows = raw
    .map(({ account }) => {
      const d = account.data;
      const v = new DataView(d.buffer, d.byteOffset, d.length);
      return {
        owner: new PublicKey(d.subarray(8, 40)).toBase58(),
        points: Number(v.getBigUint64(40, true)),
        xp: Number(v.getBigUint64(48, true)),
        wins: v.getUint32(56, true),
      };
    })
    .sort((a, b) => b.points - a.points)
    .slice(0, 25)
    .map((r) => ({ owner: r.owner, points: r.points, wins: r.wins, level: levelOf(r.xp) }));
  board = { at: Date.now(), rows };
  return rows;
}
const playerDisc: number[] = (idlJson as { accounts: { name: string; discriminator: number[] }[] }).accounts.find((a) => a.name === 'Player')!.discriminator;
const levelOf = (xp: number) => {
  let l = 1;
  while (xp >= (100 * l * (l + 1)) / 2) l++;
  return l;
};

/* ---------- wallet: Mobile Wallet Adapter on Android, injected browser wallet on web ---------- */
export const IS_WEB = Platform.OS === 'web';
const AUTH_KEY = 'gali-mwa-auth';
async function authorize(wallet: Web3MobileWallet) {
  const saved = await AsyncStorage.getItem(AUTH_KEY);
  const res = await wallet.authorize({ chain: `solana:${CLUSTER}`, identity: APP_IDENTITY, auth_token: saved ?? undefined });
  await AsyncStorage.setItem(AUTH_KEY, res.auth_token);
  return new PublicKey(Buffer.from(res.accounts[0].address, 'base64'));
}

/** `webWallet`: on web, the wallet the player picked from the list. */
export async function connectWallet(webWallet?: string): Promise<PublicKey> {
  return IS_WEB ? webConnect(webWallet) : transact(authorize);
}

export async function disconnectWallet() {
  if (IS_WEB) return webDisconnect();
  const saved = await AsyncStorage.getItem(AUTH_KEY);
  await AsyncStorage.removeItem(AUTH_KEY);
  if (saved) await transact((w) => w.deauthorize({ auth_token: saved })).catch(() => undefined);
}

export async function sendWithWallet(build: (owner: PublicKey) => Promise<TransactionInstruction[]>): Promise<string> {
  if (IS_WEB) {
    const owner = await webOwner();
    const ixs = await build(owner);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(...ixs);
    const signed = await webSign(tx);
    const sig = await connection.sendRawTransaction(signed.serialize());
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  }
  return transact(async (wallet) => {
    const owner = await authorize(wallet);
    const ixs = await build(owner);
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: owner, blockhash, lastValidBlockHeight }).add(...ixs);
    const [sig] = await wallet.signAndSendTransactions({ transactions: [tx] });
    await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return sig;
  });
}

export async function sendWithKey(signer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

/* ---------- session key: one wallet approval, then rounds are silent ---------- */
const sessionKey = (owner: PublicKey) => `gali-session-${owner.toBase58()}`;
export async function loadSession(owner: PublicKey): Promise<Keypair> {
  const raw = await AsyncStorage.getItem(sessionKey(owner));
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const k = Keypair.generate();
  await AsyncStorage.setItem(sessionKey(owner), JSON.stringify(Array.from(k.secretKey)));
  return k;
}

export const SESSION_HOURS = 24;
export const SESSION_FUND_SOL = 0.05;

/** `needSol`: SOL the session key should hold afterwards (for SOL deploys); topped up in the same approval. */
export async function startSession(owner: PublicKey, session: Keypair, hasPlayer: boolean, needSol = 0) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const bal = (await connection.getBalance(session.publicKey)) / LAMPORTS_PER_SOL;
  const want = Math.max(SESSION_FUND_SOL, needSol + 0.01);
  const fundSol = bal < Math.max(0.02, needSol + 0.005) ? Math.min(MAX_SESSION_FUND_SOL, want - bal) : 0;
  const fund = Math.max(0, Math.round(fundSol * LAMPORTS_PER_SOL));
  return sendWithWallet(async (o) => {
    if (!o.equals(owner)) throw new Error('Wallet changed; reconnect');
    const ixs: TransactionInstruction[] = [];
    if (!hasPlayer)
      ixs.push(await program.methods.initPlayer().accountsStrict({ owner: o, player: pda.player(o), systemProgram: SystemProgram.programId }).instruction());
    ixs.push(
      await program.methods
        .setSession(session.publicKey, new BN(expires), new BN(fund))
        .accountsStrict({ owner: o, player: pda.player(o), session: session.publicKey, systemProgram: SystemProgram.programId })
        .instruction(),
    );
    return ixs;
  });
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errText = (e: unknown) => String((e as { message?: string })?.message ?? e) + JSON.stringify((e as { logs?: unknown })?.logs ?? '');/* ---------- SKR transfers between miners ---------- */
const TRANSFER_CHECKED = 12;
export async function sendSkr(to: PublicKey, amount: number) {
  return sendWithWallet(async (o) => {
    if (o.equals(to)) throw new Error("You can't send SKR to yourself");
    const dest = ata(to);
    const createIdempotent = new TransactionInstruction({
      programId: ASSOCIATED_TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: o, isSigner: true, isWritable: true },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: to, isSigner: false, isWritable: false },
        { pubkey: SKR_MINT, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1]),
    });
    const data = Buffer.alloc(10);
    data[0] = TRANSFER_CHECKED;
    new DataView(data.buffer, data.byteOffset, 10).setBigUint64(1, BigInt(Math.round(amount * 10 ** SKR_DECIMALS)), true);
    data[9] = SKR_DECIMALS;
    const transfer = new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: ata(o), isSigner: false, isWritable: true },
        { pubkey: SKR_MINT, isSigner: false, isWritable: false },
        { pubkey: dest, isSigner: false, isWritable: true },
        { pubkey: o, isSigner: true, isWritable: false },
      ],
      data,
    });
    return [createIdempotent, transfer];
  });
}

/** Sign a chat message with the session key (the chat server checks it against the Player account). */
export function signWithSession(session: Keypair, message: string) {
  const sig = ed25519.sign(new TextEncoder().encode(message), session.secretKey.slice(0, 32));
  return Buffer.from(sig).toString('base64');
}

/**
 * Check that `wallet` really controls `session` right now (its on-chain Player names that key and it
 * hasn't expired) and that `sig` is the session key's signature of `message`. Player reads are cached.
 */
const playerCache = new Map<string, { at: number; p: ChainPlayer | null }>();
export async function verifySessionClaim(wallet: string, session: string, message: string, sigB64: string): Promise<boolean> {
  try {
    const hit = playerCache.get(wallet);
    const fresh = hit && Date.now() - hit.at < 60_000;
    const p = fresh ? hit!.p : await fetchPlayer(new PublicKey(wallet));
    if (!fresh) {
      if (playerCache.size > 200) playerCache.clear(); // peers can't grow this without bound
      playerCache.set(wallet, { at: Date.now(), p });
    }
    if (!p || p.session !== session || p.sessionExpires * 1000 < Date.now()) return false;
    return ed25519.verify(Buffer.from(sigB64, 'base64'), new TextEncoder().encode(message), new PublicKey(session).toBytes());
  } catch {
    return false;
  }
}

/* ---------- SKR actions (wallet approval each) ---------- */
const raw = (whole: number) => new BN(Math.round(whole * 10 ** SKR_DECIMALS).toString());

export const stakeSkr = (amount: number) =>
  sendWithWallet(async (o) => [
    await program.methods
      .stakeSkr(raw(amount))
      .accountsStrict({ owner: o, config: pda.config, player: pda.player(o), skrMint: SKR_MINT, userAta: ata(o), vault: pda.vault, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction(),
  ]);

export const unstakeSkr = (amount: number) =>
  sendWithWallet(async (o) => {
    const round = await currentRoundOnChain();
    return [
      await program.methods
        .unstakeSkr(new BN(round), raw(amount))
        .accountsStrict({
          owner: o,
          config: pda.config,
          player: pda.player(o),
          currentStake: pda.stake(o, round),
          skrMint: SKR_MINT,
          userAta: ata(o),
          vault: pda.vault,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .instruction(),
    ];
  });

/** The round the chain is in now (unstaking must name it). */
async function currentRoundOnChain() {
  const off = await clockOffsetMs().catch(() => 0);
  return Math.floor((Date.now() + off) / 1000 / ROUND_SECS);
}

export const buyGear = (item: number) =>
  sendWithWallet(async (o) => [
    await program.methods
      .buyGear(item)
      .accountsStrict({ owner: o, config: pda.config, player: pda.player(o), skrMint: SKR_MINT, userAta: ata(o), treasury: pda.treasury, motherlode: pda.motherlode, rewards: pda.rewards, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction(),
  ]);

export async function requestDevnetSol(owner: PublicKey) {
  const sig = await connection.requestAirdrop(owner, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}
