import './polyfill-web';
import { AnchorProvider, BN, Program, utils, type Idl } from '@coral-xyz/anchor';
import { transact, type Web3MobileWallet } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { Buffer } from 'buffer';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { webConnect, webDisconnect, webOwner, webSign } from './webWallet';
export { listWebWallets, PickWalletError, type WebWalletInfo } from './webWallet';
import idlJson from './idl.json';
import deployment from './deployment.json';
import { CLUSTER, MAX_SESSION_FUND_SOL, PROGRAM_ID_STR, RPC_URL, retryingFetch, SKR_MINT_STR } from './light';

export { CLUSTER, RPC_URL, chainReady, oreLive, onChainMode, isRateLimited, clockOffsetMs, MAX_SESSION_FUND_SOL, short, explorer } from './light';
// PublicKey for code outside src/chain, which reaches web3 only through this lazily loaded module.
export { PublicKey };
export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);
export const SKR_MINT = new PublicKey(SKR_MINT_STR);
export const SKR_DECIMALS = deployment.skrDecimals;
export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const APP_IDENTITY = { name: 'Gali', uri: 'https://galiisland.bounded.page', icon: 'favicon.png' };
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
const find = (...seeds: Buffer[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];
export const pda = {
  config: find(Buffer.from('config')),
  vault: find(Buffer.from('vault')),
  treasury: find(Buffer.from('treasury')),
  motherlode: find(Buffer.from('motherlode')),
  oreTreasury: find(Buffer.from('ore_treasury')),
  oreMotherlode: find(Buffer.from('ore_motherlode')),
  player: (o: PublicKey) => find(Buffer.from('player'), o.toBuffer()),
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

/** Send the leftover SOL on the session key back to the wallet (keeps enough for one fee). */
export async function sweepSession(owner: PublicKey, session: Keypair) {
  const balance = await connection.getBalance(session.publicKey);
  const amount = balance - 5_000;
  if (amount <= 0) throw new Error('the session key is already empty');
  await sendWithKey(session, [SystemProgram.transfer({ fromPubkey: session.publicKey, toPubkey: owner, lamports: amount })]);
  return amount / LAMPORTS_PER_SOL;
}

export async function fetchSkrBalance(owner: PublicKey, mint = SKR_MINT): Promise<number> {
  try {
    const b = await withTimeout(connection.getTokenAccountBalance(ata(owner, mint)));
    return Number(b.value.uiAmountString ?? b.value.uiAmount ?? 0);
  } catch (e) {
    // A missing ATA is zero; transport/rate-limit/malformed-account failures are not.
    if (/could not find account/i.test(String((e as Error)?.message ?? e)) &&
      await withTimeout(connection.getAccountInfo(ata(owner, mint))) === null) return 0;
    throw e;
  }
}

export const fetchOreBalance = (owner: PublicKey, oreMint: string) => fetchSkrBalance(owner, new PublicKey(oreMint));

/** What the shop needs from the config: the ORE mint it accepts and the dollar rates. */
export interface ShopConfig {
  oreMint: string;
  skrUsd: number; // what one whole SKR costs
  oreUsd: number; // what one whole ORE costs
  gearUsd: number[]; // item price in dollars, by gear id
}
export async function fetchShopConfig(): Promise<ShopConfig> {
  const c = await accounts.config.fetch(pda.config);
  const usd = (micro: BN) => toNum(micro) / 1e6;
  return {
    oreMint: c.oreMint.toBase58(),
    skrUsd: usd(c.skrPriceMicro),
    oreUsd: usd(c.orePriceMicro),
    gearUsd: (c.gearPricesUsd as BN[]).map(usd),
  };
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
let cachedOwner: PublicKey | null = null;
async function authorize(wallet: Web3MobileWallet) {
  const saved = await AsyncStorage.getItem(AUTH_KEY);
  const go = (auth_token?: string) => wallet.authorize({ chain: `solana:${CLUSTER}`, identity: APP_IDENTITY, auth_token });
  // A wallet that no longer accepts the saved token answers "-1/authorization request failed" (Phantom does this
  // often). Drop the token and ask once more with no token, which shows a normal approval prompt. A person who
  // declines that prompt gets the error straight away, so cancelling never loops.
  const res = await go(saved ?? undefined).catch(async (e) => {
    const text = String(e?.message ?? e);
    const staleToken = /auth(?:orization)?[_ ]token.*(?:expired|invalid)|(?:expired|invalid).*auth(?:orization)?[_ ]token/i.test(text);
    const refused = /authorization request failed/i.test(text) && !/cancel|declin|denied|reject/i.test(text);
    if (!saved || !(staleToken || refused)) throw e;
    await AsyncStorage.removeItem(AUTH_KEY);
    return go();
  });
  await AsyncStorage.setItem(AUTH_KEY, res.auth_token);
  cachedOwner = new PublicKey(Buffer.from(res.accounts[0].address, 'base64'));
  return cachedOwner;
}

/** `webWallet`: on web, the wallet the player picked from the list. */
export async function connectWallet(webWallet?: string): Promise<PublicKey> {
  return IS_WEB ? webConnect(webWallet) : transact(authorize);
}

export async function disconnectWallet() {
  if (IS_WEB) return webDisconnect();
  const saved = await AsyncStorage.getItem(AUTH_KEY);
  await AsyncStorage.removeItem(AUTH_KEY);
  cachedOwner = null;
  if (saved) await transact((w) => w.deauthorize({ auth_token: saved })).catch(() => undefined);
}

/**
 * Wait for a transaction to confirm by polling its status. web3's confirmTransaction
 * waits on a websocket subscription and only checks the status once that socket is
 * up, so an RPC without websockets (or a phone that drops the socket) hangs it until
 * the blockhash expires. Polling works with any HTTP endpoint.
 */
class VerifiedTransactionFailure extends Error {}
export class PendingTransactionError extends Error {
  constructor(public signature: string) {
    super(`Transaction outcome unknown. Do not repeat. Check signature: ${signature}`);
  }
}
const pendingKey = `gali-pending-tx-${CLUSTER}`;
interface PendingTransaction { signature: string; owner: string; lastValidBlockHeight: number }
let sending = false;

export async function confirmSig(sig: string, lastValidBlockHeight: number): Promise<void> {
  try {
    for (let i = 0; i < 90; i++) {
      // a fresh transaction is in the recent status cache; only search history once it has had time to land
      const { value } = await withTimeout(connection.getSignatureStatuses([sig], i >= 12 ? { searchTransactionHistory: true } : undefined));
      const st = value[0];
      if (st && (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized')) {
        if (st.err) throw new VerifiedTransactionFailure(`Transaction failed on chain (network fee may apply): ${JSON.stringify(st.err)}`);
        return;
      }
      if (i % 10 === 9 && (await withTimeout(connection.getBlockHeight('confirmed'))) > lastValidBlockHeight) break;
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    if (e instanceof VerifiedTransactionFailure) throw e;
  }
  throw new PendingTransactionError(sig);
}

/** Reconcile only; never resubmit an uncertain transaction. Null status is not proof of failure. */
export async function reconcilePendingTransaction(): Promise<void> {
  const raw = await AsyncStorage.getItem(pendingKey);
  if (!raw) return;
  const pending: PendingTransaction = JSON.parse(raw);
  let st;
  try {
    st = (await withTimeout(connection.getSignatureStatuses([pending.signature], { searchTransactionHistory: true }))).value[0];
  } catch { throw new PendingTransactionError(pending.signature); }
  if (!st) {
    // No record even in history, and its blockhash has expired: it never landed and never can.
    // Without this an unsent or dropped transaction would lock the wallet out for good.
    let height: number;
    try { height = await withTimeout(connection.getBlockHeight('finalized')); }
    catch { throw new PendingTransactionError(pending.signature); }
    if (height > pending.lastValidBlockHeight) { await AsyncStorage.removeItem(pendingKey); return; }
    throw new PendingTransactionError(pending.signature);
  }
  if (st.confirmationStatus !== 'confirmed' && st.confirmationStatus !== 'finalized') throw new PendingTransactionError(pending.signature);
  await AsyncStorage.removeItem(pendingKey);
  // Stop this invocation even when reconciliation succeeds: the user must review before choosing another action.
  throw new Error(st.err ? 'Previous transaction failed on chain; network fee may apply. Review before retrying.' : 'Previous transaction confirmed. Refresh balances before another action.');
}

/** Persist the signature before waiting, so a crash or lost response cannot hide a possibly-landed tx. */
async function trackAndConfirm(signature: string, owner: PublicKey, lastValidBlockHeight: number): Promise<string> {
  await AsyncStorage.setItem(pendingKey, JSON.stringify({ signature, owner: owner.toBase58(), lastValidBlockHeight } satisfies PendingTransaction));
  try {
    await confirmSig(signature, lastValidBlockHeight);
    await AsyncStorage.removeItem(pendingKey);
    return signature;
  } catch (e) {
    if (e instanceof VerifiedTransactionFailure) { await AsyncStorage.removeItem(pendingKey); throw e; }
    throw e instanceof PendingTransactionError ? e : new PendingTransactionError(signature);
  }
}

async function broadcastSigned(tx: Transaction, owner: PublicKey, lastValidBlockHeight: number): Promise<string> {
  if (!tx.signature || !tx.feePayer?.equals(owner) || !tx.verifySignatures()) throw new Error('Wallet returned an invalid signature');
  const signature = utils.bytes.bs58.encode(tx.signature);
  await AsyncStorage.setItem(pendingKey, JSON.stringify({ signature, owner: owner.toBase58(), lastValidBlockHeight } satisfies PendingTransaction));
  // No automatic RPC resubmission; the durable signature is available even if the response is lost.
  try { await withTimeout(connection.sendRawTransaction(tx.serialize(), { maxRetries: 0 })); }
  catch { throw new PendingTransactionError(signature); }
  return trackAndConfirm(signature, owner, lastValidBlockHeight);
}

export async function withTimeout<T>(work: Promise<T>, ms = 12_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Network read timed out')), ms); })]);
  } finally { clearTimeout(timer); }
}

export async function sendWithWallet(build: (owner: PublicKey) => Promise<TransactionInstruction[]>, expectedOwner?: PublicKey): Promise<string> {
  if (sending) throw new Error('A transaction is already pending');
  sending = true;
  try {
    const savedOwner = JSON.parse((await AsyncStorage.getItem('gali-owner')) ?? '{}').owner;
    if (!expectedOwner && !savedOwner) throw new Error('Connect a wallet before signing');
    const displayed = expectedOwner ?? new PublicKey(savedOwner);
    await reconcilePendingTransaction();
    const prepare = async (owner: PublicKey) => {
      if (!owner.equals(displayed)) throw new Error('Wallet changed; reconnect before signing');
      // Fresh round and blockhash after authorization. A timeout cannot continue into signing.
      const [ixs, latest] = await Promise.all([withTimeout(build(owner)), withTimeout(connection.getLatestBlockhash())]);
      const tx = new Transaction({ feePayer: owner, ...latest }).add(...ixs);
      return { tx, lastValidBlockHeight: latest.lastValidBlockHeight };
    };
    if (IS_WEB) {
      const owner = await webOwner();
      const { tx, lastValidBlockHeight } = await prepare(owner);
      const message = tx.serializeMessage();
      const signed = await webSign(tx);
      if (!message.equals(signed.serializeMessage())) throw new Error('Wallet changed the transaction');
      return await broadcastSigned(signed, owner, lastValidBlockHeight);
    }
    // Which step the wallet link was on, so a failure says where it happened.
    let step = 'opening wallet';
    const sent = await transact(async (wallet) => {
      step = 'wallet authorization';
      const owner = await authorize(wallet);
      step = 'building transaction';
      const { tx, lastValidBlockHeight } = await prepare(owner);
      step = 'wallet approval';
      // signAndSendTransactions is mandatory in MWA 2.0; signTransactions is deprecated and optional.
      const [signature] = await wallet.signAndSendTransactions({ transactions: [tx] });
      if (!signature) throw new Error('Wallet returned no signature');
      await AsyncStorage.setItem(pendingKey, JSON.stringify({ signature, owner: owner.toBase58(), lastValidBlockHeight } satisfies PendingTransaction));
      return { signature, owner, lastValidBlockHeight };
    }).catch((e) => {
      if (/Timed out waiting/i.test(String(e?.message ?? e))) throw new Error('Wallet did not respond. Check your wallet activity before trying again.');
      if (e instanceof Error && !/\(at: /.test(e.message)) e.message = `${e.message} (at: ${step})`;
      throw e;
    });
    return await trackAndConfirm(sent.signature, sent.owner, sent.lastValidBlockHeight);
  } finally { sending = false; }
}

export async function sendWithKey(signer: Keypair, ixs: TransactionInstruction[]): Promise<string> {
  if (sending) throw new Error('A transaction is already pending');
  sending = true;
  try {
    await reconcilePendingTransaction();
    const { blockhash, lastValidBlockHeight } = await withTimeout(connection.getLatestBlockhash());
    const tx = new Transaction({ feePayer: signer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
    tx.sign(signer);
    return await broadcastSigned(tx, signer.publicKey, lastValidBlockHeight);
  } finally { sending = false; }
}

/* ---------- session key: one wallet approval, then rounds are silent ---------- */
const sessionKey = (owner: PublicKey) => `gali-session-${owner.toBase58()}`;
export function assertSessionFundingAllowed() {
  if (String(CLUSTER).startsWith('mainnet')) throw new Error('Session creation and funding are disabled on mainnet; existing keys remain available for recovery');
}
export async function loadSession(owner: PublicKey): Promise<Keypair> {
  const raw = await AsyncStorage.getItem(sessionKey(owner));
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  assertSessionFundingAllowed();
  const k = Keypair.generate();
  await AsyncStorage.setItem(sessionKey(owner), JSON.stringify(Array.from(k.secretKey)));
  return k;
}

export const SESSION_HOURS = 24;
export const SESSION_FUND_SOL = 0.05;

/** `needSol`: SOL the session key should hold afterwards (for SOL deploys); topped up in the same approval. */
export async function startSession(owner: PublicKey, session: Keypair, hasPlayer: boolean, needSol = 0) {
  assertSessionFundingAllowed();
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

/** Buy gear with ORE at the config's dollar rate. The mint must be the one the config names. */
export const buyGearOre = (item: number, oreMintB58: string) =>
  sendWithWallet(async (o) => {
    const oreMint = new PublicKey(oreMintB58);
    return [
      await program.methods
      .buyGearOre(item)
      .accountsStrict({
        owner: o,
        config: pda.config,
        player: pda.player(o),
        oreMint,
        userAta: ata(o, oreMint),
        oreTreasury: pda.oreTreasury,
        oreMotherlode: pda.oreMotherlode,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
    ];
  });

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
