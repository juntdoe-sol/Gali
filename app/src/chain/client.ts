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
  TransactionInstruction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
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
  rewards: find(Buffer.from('rewards')),
  potVault: find(Buffer.from('pot_vault')),
  player: (o: PublicKey) => find(Buffer.from('player'), o.toBuffer()),
  round: (r: number) => find(Buffer.from('round'), u64le(r)),
  pot: (r: number) => find(Buffer.from('pot'), u64le(r)),
  stake: (o: PublicKey, r: number) => find(Buffer.from('stake'), o.toBuffer(), u64le(r)),
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

export async function fetchRound(roundId: number): Promise<{ winning: number; motherlode: boolean; split: boolean } | null> {
  const r = await accounts.round.fetchNullable(pda.round(roundId));
  return r ? { winning: r.winningBlock, motherlode: r.motherlode, split: r.splitReward } : null;
}

export interface ChainPot {
  perBlock: number[]; // SOL
  total: number; // SOL
  pool: number; // SOL
  skrReward: number; // whole SKR
  miners: number;
  settled: boolean;
}
export async function fetchPot(roundId: number): Promise<ChainPot | null> {
  const p = await accounts.pot.fetchNullable(pda.pot(roundId));
  if (!p) return null;
  return {
    perBlock: p.perBlock.map((v: BN) => toNum(v) / LAMPORTS_PER_SOL),
    total: toNum(p.total) / LAMPORTS_PER_SOL,
    pool: toNum(p.pool) / LAMPORTS_PER_SOL,
    skrReward: fromRaw(p.skrReward),
    miners: p.miners,
    settled: p.settled,
  };
}

let feeTo: PublicKey | null = null;
async function configAuthority() {
  feeTo = feeTo ?? (await accounts.config.fetch(pda.config)).authority;
  return feeTo!;
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

export const MAX_SESSION_FUND_SOL = 1;

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

/** Put `solPerBlock` on every block in `mask`, paid from the session key. */
export async function sessionDeploy(owner: PublicKey, session: Keypair, roundId: number, mask: number, solPerBlock: number) {
  const ix = await program.methods
    .deploy(new BN(roundId), mask, new BN(Math.floor(solPerBlock * LAMPORTS_PER_SOL)))
    .accountsStrict({
      signer: session.publicKey,
      owner,
      config: pda.config,
      player: pda.player(owner),
      pot: pda.pot(roundId),
      stake: pda.stake(owner, roundId),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return sendWithKey(session, [ix]);
}

/** Reveal if needed, settle the pot if needed, then claim our stake. Returns SOL and SKR paid to the owner. */
export async function sessionSettlePot(owner: PublicKey, session: Keypair, roundId: number) {
  if (!(await fetchRound(roundId))) {
    const revealIx = await program.methods
      .revealRound(new BN(roundId))
      .accountsStrict({ payer: session.publicKey, config: pda.config, round: pda.round(roundId), slotHashes: SYSVAR_SLOT_HASHES_PUBKEY, systemProgram: SystemProgram.programId })
      .instruction();
    await sendWithKey(session, [revealIx]).catch(() => undefined); // someone else may have revealed
  }
  const round = await fetchRound(roundId);
  if (!round) throw new Error('round not revealed');
  const ixs: TransactionInstruction[] = [];
  const pot = await fetchPot(roundId);
  if (pot && !pot.settled)
    ixs.push(
      await program.methods
        .settlePot(new BN(roundId))
        .accountsStrict({
          config: pda.config,
          round: pda.round(roundId),
          pot: pda.pot(roundId),
          feeTo: await configAuthority(),
          skrMint: SKR_MINT,
          rewards: pda.rewards,
          motherlode: pda.motherlode,
          potVault: pda.potVault,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction(),
    );
  const stake = await accounts.stake.fetchNullable(pda.stake(owner, roundId));
  if (!stake) return { ...round, payout: 0, skr: 0, lucky: false };
  ixs.push(
    await program.methods
      .claimPot(new BN(roundId))
      .accountsStrict({
        cranker: session.publicKey,
        owner,
        payer: stake.payer,
        config: pda.config,
        player: pda.player(owner),
        round: pda.round(roundId),
        pot: pda.pot(roundId),
        stake: pda.stake(owner, roundId),
        skrMint: SKR_MINT,
        potVault: pda.potVault,
        ownerAta: ata(owner),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  );
  try {
    await sendWithKey(session, ixs);
  } catch (e) {
    // the crank may have settled between our read and send: claim only
    if (ixs.length > 1) await sendWithKey(session, ixs.slice(1));
    else throw e;
  }
  // mirror claim_pot's maths from the accounts, in lamports so the lucky draw is exact
  const potRaw = await accounts.pot.fetch(pda.pot(roundId));
  const w = round.winning;
  const mine = toNum(stake.perBlock[w]);
  const start = toNum(stake.start[w]);
  const onWin = toNum(potRaw.perBlock[w]);
  const hit = mine > 0 && onWin > 0;
  const payout = hit ? (mine * toNum(potRaw.pool)) / onWin / LAMPORTS_PER_SOL : 0;
  const reward = fromRaw(potRaw.skrReward);
  const idx = toNum(potRaw.luckyIndex);
  const lucky = hit && !potRaw.splitReward && idx >= start && idx < start + mine;
  const skr = !hit ? 0 : potRaw.splitReward ? (mine * reward) / onWin : lucky ? reward : 0;
  return { ...round, payout, skr, lucky };
}

/* ---------- SKR transfers between miners ---------- */
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
      .accountsStrict({ owner: o, config: pda.config, player: pda.player(o), skrMint: SKR_MINT, userAta: ata(o), treasury: pda.treasury, motherlode: pda.motherlode, rewards: pda.rewards, tokenProgram: TOKEN_PROGRAM_ID })
      .instruction(),
  ]);

export async function requestDevnetSol(owner: PublicKey) {
  const sig = await connection.requestAirdrop(owner, LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, 'confirmed');
  return sig;
}

export const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;
export const explorer = (sig: string) => `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;
