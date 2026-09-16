import { AnchorProvider, BN, Program, type Idl } from '@coral-xyz/anchor';
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_SLOT_HASHES_PUBKEY,
  Transaction,
  type TransactionInstruction,
} from '@solana/web3.js';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import idlJson from './idl.json';
import deployment from './deployment.json';

export const CLUSTER = deployment.cluster as 'devnet';
export const RPC_URL = 'https://api.devnet.solana.com';
export const PROGRAM_ID = new PublicKey(deployment.programId);
export const SKR_MINT = new PublicKey(deployment.skrMint);
export const SKR_DECIMALS = deployment.skrDecimals;
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const APP_IDENTITY = { name: 'Gali', uri: 'https://gali.bounded.page', icon: 'favicon.png' };
export const chainReady = deployment.skrMint !== '11111111111111111111111111111111';

export const connection = new Connection(RPC_URL, 'confirmed');
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
  player: (o: PublicKey) => find(Buffer.from('player'), o.toBuffer()),
  dig: (o: PublicKey, r: number) => find(Buffer.from('dig'), o.toBuffer(), u64le(r)),
  round: (r: number) => find(Buffer.from('round'), u64le(r)),
};
export const ata = (owner: PublicKey, mint = SKR_MINT) =>
  PublicKey.findProgramAddressSync([owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()], ASSOCIATED_TOKEN_PROGRAM_ID)[0];

/* ---------- reads ---------- */
export interface ChainPlayer {
  points: number;
  xp: number;
  wins: number;
  digs: number;
  digsToday: number;
  day: number;
  streak: number;
  stakedSkr: number; // whole SKR
  gearMask: number;
  session: string;
  sessionExpires: number;
  skrWon: number; // whole SKR won from the Motherlode Pool
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
    digs: p.digs,
    digsToday: p.digsToday,
    day: p.day,
    streak: p.streak,
    stakedSkr: fromRaw(p.stakedSkr),
    gearMask: p.gearMask,
    session: p.session.toBase58(),
    sessionExpires: toNum(p.sessionExpires),
    skrWon: fromRaw(p.skrWon),
  };
}

export async function fetchRound(roundId: number): Promise<{ winning: number; motherlode: boolean } | null> {
  const r = await accounts.round.fetchNullable(pda.round(roundId));
  return r ? { winning: r.winningBlock, motherlode: r.motherlode } : null;
}

export async function fetchSkrBalance(owner: PublicKey): Promise<number> {
  try {
    const b = await connection.getTokenAccountBalance(ata(owner));
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
export async function fetchLeaderboard(): Promise<LeaderRow[]> {
  const all = await accounts.player.all();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return all
    .map((a: any) => ({ owner: a.account.owner.toBase58(), points: toNum(a.account.points), wins: a.account.wins, xp: toNum(a.account.xp) }))
    .sort((a: { points: number }, b: { points: number }) => b.points - a.points)
    .slice(0, 25)
    .map((r: { owner: string; points: number; wins: number; xp: number }) => ({ ...r, level: levelOf(r.xp) }));
}
const levelOf = (xp: number) => {
  let l = 1;
  while (xp >= (100 * l * (l + 1)) / 2) l++;
  return l;
};

/** Chain clock minus device clock, in ms. */
export async function clockOffsetMs(): Promise<number> {
  const slot = await connection.getSlot();
  const t = await connection.getBlockTime(slot);
  return t ? t * 1000 - Date.now() : 0;
}

/* ---------- wallet (Mobile Wallet Adapter) ---------- */
const AUTH_KEY = 'gali-mwa-auth';
async function authorize(wallet: Web3MobileWallet) {
  const saved = await AsyncStorage.getItem(AUTH_KEY);
  const res = await wallet.authorize({ chain: `solana:${CLUSTER}`, identity: APP_IDENTITY, auth_token: saved ?? undefined });
  await AsyncStorage.setItem(AUTH_KEY, res.auth_token);
  return new PublicKey(Buffer.from(res.accounts[0].address, 'base64'));
}

export async function connectWallet(): Promise<PublicKey> {
  return transact(authorize);
}

export async function disconnectWallet() {
  const saved = await AsyncStorage.getItem(AUTH_KEY);
  await AsyncStorage.removeItem(AUTH_KEY);
  if (saved) await transact((w) => w.deauthorize({ auth_token: saved })).catch(() => undefined);
}

async function sendWithWallet(build: (owner: PublicKey) => Promise<TransactionInstruction[]>): Promise<string> {
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

async function sendWithKey(signer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.sign(signer);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
  return sig;
}

/* ---------- session key: one wallet approval, then digs are silent ---------- */
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

export async function startSession(owner: PublicKey, session: Keypair, hasPlayer: boolean) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const bal = await connection.getBalance(session.publicKey);
  const fund = bal < 0.02 * LAMPORTS_PER_SOL ? Math.round(SESSION_FUND_SOL * LAMPORTS_PER_SOL) : 0;
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

export async function sessionDig(owner: PublicKey, session: Keypair, roundId: number, mask: number) {
  const ix = await program.methods
    .dig(new BN(roundId), mask)
    .accountsStrict({ signer: session.publicKey, owner, config: pda.config, player: pda.player(owner), dig: pda.dig(owner, roundId), systemProgram: SystemProgram.programId })
    .instruction();
  return sendWithKey(session, [ix]);
}

/** Reveal (if nobody has yet) and claim our ticket, paid by the session key. */
export async function sessionSettle(owner: PublicKey, session: Keypair, roundId: number) {
  const claimIx = await program.methods
    .claim(new BN(roundId))
    .accountsStrict({
      cranker: session.publicKey,
      owner,
      payer: session.publicKey,
      config: pda.config,
      player: pda.player(owner),
      round: pda.round(roundId),
      dig: pda.dig(owner, roundId),
      skrMint: SKR_MINT,
      motherlode: pda.motherlode,
      ownerAta: ata(owner),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const revealIx = await program.methods
    .revealRound(new BN(roundId))
    .accountsStrict({ payer: session.publicKey, config: pda.config, round: pda.round(roundId), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId })
    .instruction();
  const existing = await fetchRound(roundId);
  try {
    await sendWithKey(session, existing ? [claimIx] : [revealIx, claimIx]);
  } catch (e) {
    // someone revealed between our read and send: claim only
    if (!existing) await sendWithKey(session, [claimIx]);
    else throw e;
  }
  return fetchRound(roundId);
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
  sendWithWallet(async (o) => [
    await program.methods
      .unstakeSkr(raw(amount))
      .accountsStrict({
        owner: o,
        config: pda.config,
        player: pda.player(o),
        skrMint: SKR_MINT,
        userAta: ata(o),
        vault: pda.vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ]);

export const buyGear = (item: number) =>
  sendWithWallet(async (o) => [
    await program.methods
      .buyGear(item)
      .accountsStrict({ owner: o, config: pda.config, player: pda.player(o), skrMint: SKR_MINT, userAta: ata(o), treasury: pda.treasury, motherlode: pda.motherlode, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction(),
  ]);

export async function requestDevnetSol(owner: PublicKey) {
  const sig = await connection.requestAirdrop(owner, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
