/**
 * Stage 2, play mode. The TV holds one small fee-payer key of its own and never the player's wallet.
 *
 * Pairing: the TV opens gali-tv:<code>, the phone approves the run in its wallet and sends back its address, and the
 * TV only counts itself paired once it finds that owner's ORE automation on chain playing exactly what the TV asked
 * for (every spot, the per-spot amount, an open executor, enough balance for the rounds left).
 *
 * Playing: the automation is open, so anyone may press deploy; Gali's server does every round and ORE ignores a
 * second deploy. While the TV is on it presses too, signed by its own key (deployFromAutomation is reused unchanged:
 * the TV key is filed under the owner's executor slot). Results come from the owner's own miner account: ORE credits
 * a round when it is checkpointed, so the TV notes the lifetime totals while a round is open and reports the change
 * once that round is settled.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Keypair, PublicKey } from '@solana/web3.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { deployAutopilot, fetchBoardRound } from '../chain/board';
import { connection } from '../chain/client';
import { AUTOMATION_STRATEGY, EXECUTOR_ADDRESS } from '../chain/ore/consts';
import { fetchOreAutomation, fetchOreMiner } from '../chain/ore/read';
import { AUTOPILOT_FEE_LAMPORTS, LIVE_LOCK_SLOTS, toOre, toSol } from '../chain/ore/tx';
import { getSecret, setSecret } from '../chain/secure';
import type { Live } from './data';
import { makeCode, openPairChannel, PAIR_TTL_MS, perSpotLamports, TV_SPOTS, type PairChannel, type PairRequest } from './link';

const KEY_NAME = 'gali-tv-fee-payer';
const PAIRED_KEY = 'gali-tv-paired';
const ALL_SPOTS = Array.from({ length: TV_SPOTS }, (_, i) => i);
const ALL_MASK = 0x1ffffff;
/** Let Gali's server deploy first; the TV only presses once the round is this far in. */
const DEPLOY_AFTER_MS = 12_000;
/** EXPO_PUBLIC_TV_DEPLOY=0 builds a TV that follows a paired run without sending anything. */
const TV_DEPLOYS = process.env.EXPO_PUBLIC_TV_DEPLOY !== '0';

/** The TV's own fee-payer key, made on first launch and kept in the Android keystore. */
export async function loadTvKey(): Promise<Keypair> {
  const raw = await getSecret(KEY_NAME);
  if (raw) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw)));
  const k = Keypair.generate();
  await setSecret(KEY_NAME, JSON.stringify(Array.from(k.secretKey)));
  return k;
}

export interface Paired {
  owner: string;
  /** lamports per round, all spots */
  lpr: number;
  rounds: number;
}

export async function loadPaired(): Promise<Paired | null> {
  try {
    const raw = await AsyncStorage.getItem(PAIRED_KEY);
    const p = raw ? (JSON.parse(raw) as Paired) : null;
    return p && typeof p.owner === 'string' ? p : null;
  } catch {
    return null;
  }
}
export const clearPaired = () => AsyncStorage.removeItem(PAIRED_KEY).catch(() => undefined);

/**
 * Files the TV key as this owner's executor key, so deployFromAutomation (which looks a device key up by owner)
 * signs with it. Same slot name as loadExecutor in chain/ore/tx.ts.
 */
async function adoptKey(owner: string, key: Keypair) {
  await setSecret(`gali-ore-exec-${owner}`, JSON.stringify(Array.from(key.secretKey)));
}

/** Per-round cost of a run: every spot plus the executor fee. */
const roundCost = (lpr: number) => BigInt(perSpotLamports(lpr)) * BigInt(TV_SPOTS) + AUTOPILOT_FEE_LAMPORTS;

/** Is `owner` running the automation this TV asked for? Reads the chain only. */
export async function checkRun(owner: string, lpr: number, rounds: number): Promise<{ ok: boolean; roundsLeft: number; reason?: string }> {
  let pk: PublicKey;
  try {
    pk = new PublicKey(owner);
  } catch {
    return { ok: false, roundsLeft: 0, reason: 'bad address' };
  }
  const a = await fetchOreAutomation(connection, pk);
  if (!a) return { ok: false, roundsLeft: 0, reason: 'no automation yet' };
  const cost = roundCost(lpr);
  const roundsLeft = Number(a.balance / cost);
  if (!a.executor.equals(EXECUTOR_ADDRESS)) return { ok: false, roundsLeft, reason: 'not an open autopilot' };
  if (Number(a.strategy) !== AUTOMATION_STRATEGY.Preferred || Number(a.mask & 0x1ffffffn) !== ALL_MASK) return { ok: false, roundsLeft, reason: 'not every spot' };
  if (a.amount !== BigInt(perSpotLamports(lpr))) return { ok: false, roundsLeft, reason: 'different amount' };
  if (roundsLeft < 1 || roundsLeft > rounds) return { ok: false, roundsLeft, reason: 'different rounds' };
  return { ok: true, roundsLeft };
}

/* ---------------- pairing ---------------- */

export type PairStatus = 'starting' | 'waiting' | 'checking' | 'expired' | 'error';

/** Runs one pairing attempt for `lpr`/`rounds` while mounted. `onPaired` fires once the chain agrees. */
export function usePairing(lpr: number, rounds: number, onPaired: (p: Paired) => void) {
  const [req, setReq] = useState<PairRequest | null>(null);
  const [status, setStatus] = useState<PairStatus>('starting');
  const [error, setError] = useState<string | null>(null);
  const [gen, setGen] = useState(0);
  const done = useRef(false);

  useEffect(() => {
    let dead = false;
    let ch: PairChannel | null = null;
    let expiry: ReturnType<typeof setTimeout> | null = null;
    let resend: ReturnType<typeof setInterval> | null = null;
    done.current = false;
    setStatus('starting');
    setError(null);
    (async () => {
      try {
        const key = await loadTvKey();
        const r: PairRequest = { code: makeCode(), tv: key.publicKey.toBase58(), lpr, rounds, spots: 'all', exp: Date.now() + PAIR_TTL_MS };
        if (dead) return;
        setReq(r);
        const payload = { ...r } as unknown as Record<string, unknown>;
        let checking = false;
        ch = await openPairChannel(
          r.code,
          (event, p) => {
            if (dead || done.current) return;
            if (event === 'hello') ch?.send('req', payload);
            if (event !== 'owner' || typeof p.owner !== 'string' || checking) return;
            const owner = p.owner;
            checking = true;
            setStatus('checking');
            // The wallet's transaction can take a few seconds to land: look for a minute before giving up.
            void (async () => {
              for (let i = 0; i < 15 && !dead; i++) {
                const c = await checkRun(owner, lpr, rounds).catch(() => ({ ok: false, roundsLeft: 0, reason: 'rpc' }));
                if (c.ok) {
                  done.current = true;
                  await adoptKey(owner, key);
                  const paired = { owner, lpr, rounds };
                  await AsyncStorage.setItem(PAIRED_KEY, JSON.stringify(paired));
                  ch?.send('ack', { owner, ok: true });
                  if (!dead) onPaired(paired);
                  return;
                }
                await new Promise((res) => setTimeout(res, 4000));
              }
              if (dead) return;
              checking = false;
              ch?.send('ack', { owner, ok: false });
              setStatus('waiting');
              setError('No matching autopilot on chain · try again on your Seeker');
            })();
          },
          () => {
            if (dead) return;
            setStatus('waiting');
            ch?.send('req', payload);
          },
        );
        resend = setInterval(() => ch?.send('req', payload), 5000);
        expiry = setTimeout(() => !done.current && setStatus('expired'), Math.max(0, r.exp - Date.now()));
      } catch (e) {
        if (!dead) {
          setStatus('error');
          setError(String((e as Error)?.message ?? e));
        }
      }
    })();
    return () => {
      dead = true;
      if (expiry) clearTimeout(expiry);
      if (resend) clearInterval(resend);
      ch?.close();
    };
    // onPaired is read at call time; a new attempt only on gen/lpr/rounds changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen, lpr, rounds]);

  const renew = useCallback(() => setGen((g) => g + 1), []);
  return { req, status, error, renew };
}

/* ---------------- playing ---------------- */

export interface RoundResult {
  round: number;
  /** 1-based winning spot, null when the round had no draw */
  spot: number | null;
  /** the owner had SOL on the winning spot (always, with every spot covered, when there was a draw) */
  hit: boolean;
  sol: number;
  ore: number;
  at: number;
}

export interface PlayState {
  status: 'checking' | 'on' | 'finished';
  roundsLeft: number | null;
  /** the round the TV itself last deployed into */
  deployed: number | null;
  result: RoundResult | null;
  error: string | null;
}

/** Follows a paired run every time the live round is polled: presses deploy, reports results, notices the end. */
export function usePlay(paired: Paired | null, live: Live): PlayState {
  const [state, setState] = useState<PlayState>({ status: 'checking', roundsLeft: null, deployed: null, result: null, error: null });
  const snap = useRef<{ round: bigint; sol: bigint; ore: bigint } | null>(null);
  const tried = useRef<{ round: bigint; n: number }>({ round: -1n, n: 0 });
  const busy = useRef(false);
  const owner = paired?.owner;

  useEffect(() => {
    snap.current = null;
    tried.current = { round: -1n, n: 0 };
    setState({ status: 'checking', roundsLeft: null, deployed: null, result: null, error: null });
  }, [owner]);

  useEffect(() => {
    if (!paired || !live.clock || busy.current) return;
    const clock = live.clock;
    busy.current = true;
    void (async () => {
      try {
        const pk = new PublicKey(paired.owner);
        const [a, miner] = await Promise.all([fetchOreAutomation(connection, pk), fetchOreMiner(connection, pk)]);

        // 1. The owner's results, from their miner account
        let result: RoundResult | null = null;
        if (miner) {
          const s = snap.current;
          if (s && miner.checkpointId >= s.round) {
            const r = await fetchBoardRound(s.round).catch(() => null);
            const spot = r && r.winning !== null ? r.winning + 1 : null;
            result = { round: Number(s.round), spot, hit: spot !== null, sol: toSol(miner.lifetimeRewardsSol - s.sol), ore: toOre(miner.lifetimeRewardsOre - s.ore), at: Date.now() };
            snap.current = null;
          }
          if (miner.roundId !== miner.checkpointId && miner.deployed.some((d) => d > 0n) && snap.current?.round !== miner.roundId)
            snap.current = { round: miner.roundId, sol: miner.lifetimeRewardsSol, ore: miner.lifetimeRewardsOre };
        }

        // 2. The run is over once ORE has closed the automation
        if (!a) {
          await clearPaired();
          setState((p) => ({ ...p, status: 'finished', roundsLeft: 0, result: result ?? p.result }));
          return;
        }
        const roundsLeft = Number(a.balance / roundCost(paired.lpr));

        // 3. Press deploy, once Gali's server has had its chance, if nobody has yet
        let deployed: number | null = null;
        let error: string | null = null;
        const playedNow = miner && miner.roundId === clock.roundId && miner.deployed.some((d) => d > 0n);
        const elapsed = Number(clock.endSlot - clock.startSlot) * 400 - clock.msLeft + (Date.now() - live.at);
        if (TV_DEPLOYS && !playedNow && roundsLeft > 0 && clock.phase === 'mining' && clock.slotsLeft >= LIVE_LOCK_SLOTS && elapsed >= DEPLOY_AFTER_MS) {
          if (tried.current.round !== clock.roundId) tried.current = { round: clock.roundId, n: 0 };
          if (tried.current.n < 2) {
            tried.current.n++;
            try {
              deployed = await deployAutopilot(pk, ALL_SPOTS, perSpotLamports(paired.lpr) / 1e9);
            } catch (e) {
              const msg = String((e as Error)?.message ?? e);
              if (msg !== 'RoundLocked') error = msg.slice(0, 120);
            }
          }
        }
        setState((p) => ({ status: 'on', roundsLeft, deployed: deployed ?? p.deployed, result: result ?? p.result, error }));
      } catch (e) {
        setState((p) => ({ ...p, error: String((e as Error)?.message ?? e).slice(0, 120) }));
      } finally {
        busy.current = false;
      }
    })();
  }, [paired, live.at, live.clock]);

  return state;
}
