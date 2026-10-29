/**
 * Gali NFTs in the game: the Founding Miner certificate and the inventory.
 *
 * Everything goes through the `nft` Supabase function (supabase/functions/nft):
 *  - status: is this wallet a Founding Miner (it mined a live ORE round during the closed beta), and its claim
 *  - build: the mint transaction, already signed by Gali for the new asset and the collection; the miner signs as
 *    fee payer and pays the mint (Solana rent plus fees, shown by the wallet before approving)
 *  - confirm: once sent, the server checks the certificate is in the wallet
 *  - inventory: the Gali NFTs a wallet holds (read with Helius DAS on the server)
 *
 * The claim popup shows once per wallet per day while a Founding Miner has not claimed yet.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { loadChain } from '../chain/lazy';
import { signIn, useDm } from './dm';
import { play } from './sfx';
import { useGame } from './store';
import { publicKey, restBase } from './world';

export interface CertClaim {
  serial: number;
  asset: string;
  status: 'reserved' | 'minted';
  rounds: number;
  first_at: string | null;
}
export interface CertStatus {
  eligible: boolean;
  reason?: 'not-a-gali-miner' | 'no-beta-rounds' | null;
  rounds: number;
  firstAt: string | null;
  name: string | null;
  claim: CertClaim | null;
  /** the mint is set up on the server (collection and authority) */
  open: boolean;
}
export interface InvItem {
  id: string;
  name: string;
  image: string | null;
  kind: 'cert' | 'gear';
  attributes: { trait_type: string; value: unknown }[];
}

interface NftState {
  wallet: string | null;
  cert: CertStatus | null;
  items: InvItem[];
  loading: boolean;
  /** the claim popup */
  popup: boolean;
  claiming: null | 'signing-in' | 'building' | 'wallet' | 'confirming';
  error: string | null;
  /** the asset just minted, for the celebration */
  minted: string | null;
  refresh: (wallet: string | null, force?: boolean) => Promise<void>;
  claim: () => Promise<void>;
  openPopup: () => void;
  later: () => void;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const base = restBase();
  if (!base) throw new Error('Not connected to the Gali server');
  const r = await fetch(`${base}/functions/v1/nft`, {
    method: 'POST',
    headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 202) throw new Error((j as { error?: string }).error || `Server said ${r.status}`);
  return j as T;
}

const LATER_KEY = 'gali-cert-later';
const LATER_MS = 24 * 3600_000;
let lastAt = 0;
const b64ToBytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useNft = create<NftState>((set, get) => ({
  wallet: null,
  cert: null,
  items: [],
  loading: false,
  popup: false,
  claiming: null,
  error: null,
  minted: null,

  async refresh(wallet, force = false) {
    if (!wallet) {
      set({ wallet: null, cert: null, items: [], popup: false });
      return;
    }
    if (!force && wallet === get().wallet && Date.now() - lastAt < 60_000) return;
    lastAt = Date.now();
    set({ wallet, loading: true, error: null });
    try {
      const [cert, inv] = await Promise.all([
        call<CertStatus>({ a: 'status', wallet }),
        call<{ items: InvItem[] }>({ a: 'inventory', wallet }).catch(() => ({ items: [] as InvItem[] })),
      ]);
      if (get().wallet !== wallet) return;
      set({ cert, items: inv.items, loading: false });
      // the popup: a Founding Miner who has not claimed yet, at most once a day
      if (cert.eligible && cert.claim?.status !== 'minted' && !get().popup) {
        const later = Number((await AsyncStorage.getItem(`${LATER_KEY}:${wallet}`)) ?? 0);
        if (Date.now() - later > LATER_MS) set({ popup: true });
      }
    } catch (e) {
      set({ loading: false, error: (e as Error).message });
    }
  },

  openPopup() {
    set({ popup: true, error: null });
  },

  later() {
    const w = get().wallet;
    set({ popup: false, error: null });
    if (w) void AsyncStorage.setItem(`${LATER_KEY}:${w}`, String(Date.now()));
  },

  async claim() {
    const wallet = get().wallet;
    if (!wallet || get().claiming) return;
    set({ error: null });
    try {
      let pass = useDm.getState().me === wallet ? useDm.getState().pass : null;
      if (!pass) {
        set({ claiming: 'signing-in' });
        await signIn();
        pass = useDm.getState().pass;
        if (!pass) throw new Error('Sign-in was not completed');
      }
      set({ claiming: 'building' });
      const built = await call<{ tx: string; asset: string; serial: number; lastValidBlockHeight: number }>({ a: 'build', pass });
      set({ claiming: 'wallet' });
      const chain = await loadChain();
      const sig = await chain.sendPrebuilt(b64ToBytes(built.tx), built.lastValidBlockHeight);
      set({ claiming: 'confirming' });
      // the chain has it; give the server's read a few tries to catch up
      for (let k = 0; k < 6; k++) {
        const r: { claim?: CertClaim; pending?: boolean } = await call<{ claim?: CertClaim; pending?: boolean }>({ a: 'confirm', pass, sig }).catch(() => ({ pending: true }));
        if (r.claim?.status === 'minted') break;
        await wait(2500);
      }
      set({ claiming: null, minted: built.asset });
      play('levelup');
      useGame.getState().toast(`Founding Miner #${String(built.serial).padStart(4, '0')} is in your wallet`, 'gold');
      await get().refresh(wallet, true);
    } catch (e) {
      const m = (e as Error).message || 'Something went wrong';
      set({ claiming: null, error: /reject|declin|cancel/i.test(m) ? 'You cancelled in your wallet. Nothing was spent.' : m });
    }
  },
}));

/** Days are shown in Malaysia time, like the rest of the game. */
export function fmtDay(iso: string | null): string {
  if (!iso) return '-';
  const d = new Date(Date.parse(iso) + 8 * 3600_000);
  return `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
