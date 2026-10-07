/**
 * The lobby arcade: Tunnel Collapse, Gold Rush Pot and Crash Cart, each with an ORE table and an SKR table.
 *
 * Rounds are 40 s slots of the house clock. A player stakes by sending ORE or SKR to the house wallet with a memo
 * (the choice and the round). 30 s into the round the stakes close; at 46 s the round settles and winners are paid
 * from the house wallet automatically. Before each round the house shows a hash of its secret; after, the secret,
 * so anyone can check the draw. All rules live in rpc-backend/functions/games.mjs: this file only talks to it.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { loadArcade } from '../chain/lazy';
import { announce } from './lobby';
import { useGame } from './store';

export type GameId = 'tunnel' | 'pot' | 'crash';
export type TokenId = 'ore' | 'skr';
export const GAME_IDS: GameId[] = ['tunnel', 'pot', 'crash'];
const CODE: Record<GameId, string> = { tunnel: 't', pot: 'p', crash: 'c' };
const TCODE: Record<TokenId, string> = { ore: 'o', skr: 's' };

export const GAME_META: Record<GameId, { name: string; line: string; how: string; color: string; icon: string }> = {
  tunnel: {
    name: 'TUNNEL COLLAPSE',
    line: 'Pick a tunnel. One caves in.',
    how: 'Five tunnels, one cave-in. Miners in the other four tunnels split the stakes of the collapsed one, minus the 5% house fee. Nobody in the collapsed tunnel, or everyone in it: everyone is refunded.',
    color: '#ff9a3d',
    icon: '⛏',
  },
  pot: {
    name: 'GOLD RUSH POT',
    line: 'Buy in. One miner strikes gold.',
    how: 'Every stake buys tickets in the pot. One ticket is drawn and its miner takes the whole pot minus the 5% house fee. More tickets, better odds. A pot with one player is refunded.',
    color: '#ffcf4a',
    icon: '💰',
  },
  crash: {
    name: 'CRASH CART',
    line: 'Pick a cash-out. Beat the crash.',
    how: 'A minecart climbs and crashes at a random multiplier. Pick your cash-out before the round: if the cart reaches it, you win your stake times the cash-out. If it crashes first, the stake is lost. 5% house edge.',
    color: '#3de0c8',
    icon: '🛒',
  },
};
export const CRASH_TARGETS = [12, 15, 20, 30, 50, 100]; // choice / 10 = multiplier (1.2x to 10x)

export interface TableCfg {
  ready: boolean;
  mint: string;
  decimals?: number;
  program?: string;
  houseAta?: string;
  chips: string[];
  capUnits?: string;
  reason?: string;
}
export interface ArcadeCfg {
  house: string;
  tokens: Record<TokenId, TableCfg>;
  roundMs: number;
  betMs: number;
  settleAfterMs: number;
  feeBps: number;
}
export interface MyStake {
  game: GameId;
  token: TokenId;
  round: number;
  choice: number;
  amount: string;
  sig: string;
}
export interface RoundResult {
  game: GameId;
  token: TokenId;
  round: number;
  status: 'paid' | 'void' | 'none' | 'pending' | 'failed';
  decimals?: number;
  commit: string;
  secret: string;
  seed: string;
  outcome: { collapsed?: number; pool?: string[]; winner?: string; pot?: string; crash?: number; void?: string; none?: boolean; fee?: string };
  bets: { who: string; short: string; sig: string; amount: string; choice: number }[];
  pays: { who: string; short: string; amount: string; kind: 'win' | 'refund'; sig: string }[];
  /** what this wallet staked and got back, in token units */
  mine: { staked: number; back: number; net: number } | null;
}

/** Client cutoff for new stakes: 10 s before the house stops counting them, so a wallet approval can still land. */
export const CLIENT_CUTOFF_MS = 20_000;
const KEY = 'gali-arcade-stakes-v1';

interface ArcadeState {
  game: GameId | null;
  token: TokenId;
  cfg: ArcadeCfg | null;
  cfgError: string | null;
  offsetMs: number;
  commit: { key: string; round: number; hash: string } | null;
  choice: Record<GameId, number>;
  chip: number;
  busy: boolean;
  stakes: MyStake[];
  results: RoundResult[];
  note: string | null;
  open: (g: GameId | null) => void;
  setToken: (t: TokenId) => void;
  setChoice: (n: number) => void;
  setChip: (i: number) => void;
  stake: () => Promise<void>;
  tick: () => void;
  resume: () => void;
  balance: Record<TokenId, number | null>;
}

const settling = new Set<string>();
const tries = new Map<string, number>();
const nextTry = new Map<string, number>();
let commitBusy = false;
let cfgBusy = false;
let loaded = false;
let loop: ReturnType<typeof setInterval> | null = null;

const key = (s: { game: GameId; token: TokenId; round: number }) => `${s.game}:${s.token}:${s.round}`;
const save = (stakes: MyStake[]) => AsyncStorage.setItem(KEY, JSON.stringify(stakes.slice(-30))).catch(() => undefined);

export const useArcade = create<ArcadeState>((set, get) => {
  /** While stakes wait to be settled, check every few seconds even if the arcade is closed. */
  const startLoop = () => {
    if (loop) return;
    loop = setInterval(() => {
      if (!get().stakes.length) {
        if (loop) clearInterval(loop);
        loop = null;
        return;
      }
      get().tick();
    }, 2500);
  };
  const now = () => Date.now() + get().offsetMs;
  const roundMs = () => get().cfg?.roundMs ?? 40_000;

  async function loadCfg() {
    if (cfgBusy) return;
    cfgBusy = true;
    try {
      const a = await loadArcade();
      const cfg = await a.arcadeCall<ArcadeCfg & { serverNow: number }>({ action: 'config' });
      set({ cfg, cfgError: null, offsetMs: cfg.serverNow - Date.now() });
    } catch (e) {
      set({ cfgError: String((e as Error)?.message ?? e).slice(0, 160) });
    } finally {
      cfgBusy = false;
    }
  }

  async function loadBalance(t: TokenId) {
    const cfg = get().cfg;
    const owner = useGame.getState().wallet.owner;
    const tb = cfg?.tokens[t];
    if (!owner || !tb?.ready || !tb.program) return;
    try {
      const a = await loadArcade();
      const { PublicKey } = await import('@solana/web3.js');
      const v = await a.tokenBalance(new PublicKey(owner), { mint: tb.mint, program: tb.program });
      set((s) => ({ balance: { ...s.balance, [t]: v } }));
    } catch {
      /* keep the last number */
    }
  }

  async function ensureCommit() {
    const { game, token, cfg, commit } = get();
    if (!game || !cfg?.tokens[token]?.ready || commitBusy) return;
    const round = Math.floor(now() / roundMs());
    const k = `${game}:${token}`;
    if (commit && commit.key === k && commit.round === round) return;
    commitBusy = true;
    try {
      const a = await loadArcade();
      const r = await a.arcadeCall<{ commit: string; round: number; serverNow: number }>({ action: 'commit', game, token, round });
      set({ commit: { key: k, round: r.round, hash: r.commit }, offsetMs: r.serverNow - Date.now() });
    } catch {
      /* the next tick retries */
    } finally {
      commitBusy = false;
    }
  }

  async function settle(g: GameId, t: TokenId, round: number) {
    const k = key({ game: g, token: t, round });
    if (settling.has(k)) return;
    if ((nextTry.get(k) ?? 0) > Date.now()) return;
    settling.add(k);
    try {
      const a = await loadArcade();
      const r = await a.arcadeCall<RoundResult & { early?: boolean; retryMs?: number; serverNow?: number; decimals?: number }>({ action: 'settle', game: g, token: t, round }, 20_000);
      if (r.serverNow) set({ offsetMs: r.serverNow - Date.now() });
      if (r.early) {
        nextTry.set(k, Date.now() + Math.max(1000, r.retryMs ?? 3000));
        return;
      }
      if (r.status === 'pending' || r.status === 'failed') {
        const n = (tries.get(k) ?? 0) + 1;
        tries.set(k, n);
        nextTry.set(k, Date.now() + 4000);
        if (n >= 15) get().open(get().game); // keep the stake saved; the next visit settles it
        return;
      }
      const owner = useGame.getState().wallet.owner;
      const mine = get().stakes.filter((s) => key(s) === k);
      const staked = mine.reduce((n, s) => n + Number(s.amount), 0);
      const back = owner ? r.pays.filter((p) => p.who === owner).reduce((n, p) => n + Number(p.amount), 0) : 0;
      const result: RoundResult = { ...r, game: g, token: t, round, mine: mine.length ? { staked, back, net: back - staked } : null };
      const stakes = get().stakes.filter((s) => key(s) !== k);
      set((s) => ({ stakes, results: [result, ...s.results].slice(0, 12) }));
      save(stakes);
      if (result.mine) {
        const net = result.mine.net;
        const tk = t === 'ore' ? 'ORE' : 'SKR';
        const toast = useGame.getState().toast;
        if (net > 0) {
          toast(`You won ${fmtAmt(net)} ${tk}!`, 'good');
          announce({ k: 'play', g, a: Number(fmtAmt(net)), tk, win: true });
        } else if (result.status === 'void') toast('Round refunded', 'info');
        else toast(`Collapsed. Better luck next round`, 'info');
        void useGame.getState().refreshWallet();
        void loadBalance(t);
      }
    } catch {
      nextTry.set(k, Date.now() + 5000);
    } finally {
      settling.delete(k);
    }
  }

  return {
    game: null,
    token: 'ore',
    cfg: null,
    cfgError: null,
    offsetMs: 0,
    commit: null,
    choice: { tunnel: 0, pot: 0, crash: 20 },
    chip: 1,
    busy: false,
    stakes: [],
    results: [],
    note: null,
    balance: { ore: null, skr: null },

    open: (g) => {
      set({ game: g, note: null, commit: null });
      if (g) {
        if (!get().cfg) void loadCfg();
        else void loadBalance(get().token);
      }
    },
    setToken: (t) => {
      set({ token: t, chip: 1, commit: null });
      void loadBalance(t);
    },
    setChoice: (n) => set((s) => ({ choice: { ...s.choice, ...(s.game ? { [s.game]: n } : {}) } })),
    setChip: (i) => set({ chip: i }),

    stake: async () => {
      const { game, token, cfg, busy, chip, choice } = get();
      const g = useGame.getState();
      if (!game || !cfg || busy) return;
      const tb = cfg.tokens[token];
      if (!tb.ready || !tb.houseAta || !tb.program || tb.decimals === undefined) return g.toast('This table is not open yet', 'info');
      if (!g.wallet.owner) return g.toast('Connect your wallet first', 'bad');
      const into = now();
      const round = Math.floor(into / cfg.roundMs);
      if (into - round * cfg.roundMs > CLIENT_CUTOFF_MS) return g.toast('Stakes are closed. The next round opens soon.', 'info');
      const amount = tb.chips[chip];
      const mine = get().stakes.filter((s) => s.game === game && s.token === token && s.round === round).reduce((n, s) => n + Number(s.amount), 0);
      const cap = (Number(tb.capUnits ?? '0') / 10 ** tb.decimals) || Infinity;
      if (mine + Number(amount) > cap) return g.toast(`Limit reached: ${cap} ${token.toUpperCase()} per round`, 'info');
      const have = get().balance[token];
      if (have !== null && have < Number(amount)) return g.toast(`Not enough ${token.toUpperCase()} (you have ${fmtAmt(have)})`, 'bad');
      const pick = game === 'pot' ? 0 : choice[game];
      const memo = `gali1|${CODE[game]}|${TCODE[token]}|${round}|${pick}`;
      set({ busy: true, note: 'Approve in your wallet…' });
      try {
        const a = await loadArcade();
        const sig = await a.sendStake({ mint: tb.mint, houseAta: tb.houseAta, decimals: tb.decimals, program: tb.program }, amount, memo);
        const stake: MyStake = { game, token, round, choice: pick, amount, sig };
        const stakes = [...get().stakes, stake];
        set({ stakes, note: null });
        save(stakes);
        startLoop();
        announce({ k: 'play', g: game, a: Number(amount), tk: token === 'ore' ? 'ORE' : 'SKR', win: false });
        g.toast(`Staked ${amount} ${token.toUpperCase()}`, 'good');
        void loadBalance(token);
      } catch (e) {
        const m = String((e as Error)?.message ?? e);
        const quiet = /declined|cancel|rejected/i.test(m);
        set({ note: null });
        g.toast(quiet ? 'Cancelled in wallet' : m.slice(0, 140), quiet ? 'info' : 'bad');
      } finally {
        set({ busy: false });
      }
    },

    /** Called every second while the arcade is open, and a little slower in the background when stakes are waiting. */
    tick: () => {
      const s = get();
      if (s.game) void ensureCommit();
      const t = now();
      for (const st of s.stakes) {
        const start = st.round * roundMs();
        if (t >= start + (s.cfg?.settleAfterMs ?? 46_000)) void settle(st.game, st.token, st.round);
      }
    },

    /** Pick up stakes saved by an earlier visit (the app closed before the round settled) and settle them. */
    resume: () => {
      if (loaded) return;
      loaded = true;
      void AsyncStorage.getItem(KEY).then((raw) => {
        try {
          const list = JSON.parse(raw ?? '[]') as MyStake[];
          if (Array.isArray(list) && list.length) {
            set({ stakes: list.filter((x) => x && GAME_IDS.includes(x.game) && (x.token === 'ore' || x.token === 'skr') && Number.isSafeInteger(x.round)) });
            startLoop();
            if (!get().cfg) void loadCfg().then(() => get().tick());
          }
        } catch {
          /* ignore a damaged save */
        }
      });
    },
  };
});

export const fmtAmt = (n: number) => {
  const a = Math.abs(n);
  const d = a >= 100 ? 0 : a >= 1 ? 2 : a >= 0.1 ? 3 : 4;
  return n.toFixed(d).replace(/\.?0+$/, '') || '0';
};
