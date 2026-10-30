/**
 * Gali NFTs in the game: the Founding Miner certificate, the Level 10 and Level 20 milestone certificates, and the
 * inventory.
 *
 * Everything goes through the `nft` Supabase function (supabase/functions/nft):
 *  - status: is this wallet a Founding Miner (it mined a live ORE round during the closed beta), and its claim
 *  - status also carries `milestones`: the wallet's server-worked level and each milestone certificate's claim
 *  - build: the mint transaction (a `kind` such as 'lv10' for a milestone certificate), already signed by Gali for the new asset and the collection; the miner signs as
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
export type MilestoneKind = 'lv3' | 'lv6' | 'lv10' | 'lv15' | 'lv20' | 'lv30';
export type MilestoneRarity = 'Uncommon' | 'Rare' | 'Legendary';
export type ClaimKind = 'founding' | MilestoneKind;
export interface MilestoneClaim {
  kind: MilestoneKind;
  serial: number;
  asset: string;
  status: 'reserved' | 'minted';
  level: number;
}
export interface MilestoneInfo {
  need: number;
  rarity: MilestoneRarity;
  eligible: boolean;
  claim: MilestoneClaim | null;
}
export interface Milestones {
  /** level and XP as the server worked them out (verified XP) */
  level: number;
  xp: number;
  /** the milestone mint is set up on the server */
  open: boolean;
  lv3?: MilestoneInfo;
  lv6?: MilestoneInfo;
  lv10: MilestoneInfo;
  lv15?: MilestoneInfo;
  lv20: MilestoneInfo;
  lv30?: MilestoneInfo;
}
/** What each milestone certificate is and what it rolls when the market opens. */
export interface MilestoneDef {
  level: number;
  title: string;
  rarity: MilestoneRarity;
  /** what the certificate claims, in words ("1 random Rare weapon") */
  reward: string;
  /** the names it rolls between (one name: no roll) */
  rewards: string[];
  /** catalogue ids to show (Level 30: each outfit's top) */
  ids: string[];
  /** the word for one reward: weapon, shoes, outfit */
  noun: string;
}
const OUTFIT_TOPS = ['G567', 'G569', 'G571', 'G573', 'G575', 'G577', 'G579', 'G581', 'G583', 'G585'];
export const MILESTONE: Record<MilestoneKind, MilestoneDef> = {
  lv3: { level: 3, title: 'Level 3', rarity: 'Uncommon', reward: 'Baby Steps Boots', rewards: ['Baby Steps Boots'], ids: ['G562'], noun: 'shoes' },
  lv6: { level: 6, title: 'Level 6', rarity: 'Uncommon', reward: 'Six Pack Tee', rewards: ['Six Pack Tee'], ids: ['G563'], noun: 'top' },
  lv10: { level: 10, title: 'Level 10', rarity: 'Rare', reward: '1 random Rare weapon', rewards: ['Ten Bagger Pick', 'Level Up Pick', 'XP Bar Blade'], ids: ['G556', 'G557', 'G558'], noun: 'weapon' },
  lv15: { level: 15, title: 'Level 15', rarity: 'Rare', reward: '1 random pair of Rare shoes', rewards: ['Ore Crusher Boots', 'Speedrun Sneakers', 'Lava Walkers'], ids: ['G564', 'G565', 'G566'], noun: 'shoes' },
  lv20: { level: 20, title: 'Level 20', rarity: 'Legendary', reward: '1 random Legendary weapon', rewards: ['Wen Moon Hammer', 'Bull Run Axe', 'Genesis Block Hammer'], ids: ['G559', 'G560', 'G561'], noun: 'weapon' },
  lv30: {
    level: 30,
    title: 'Level 30',
    rarity: 'Legendary',
    reward: '1 random Legendary outfit, top and pants',
    rewards: ['Ore King Regalia', 'Gradient Prime Suit', 'Pump Tracksuit', 'Magma Core Suit', 'Frost Vein Armour', 'Void Walker Suit', 'Overclock Hazmat', 'Ronin Miner Gi', 'Gold Rush Duster', 'Astro Miner Suit'],
    ids: OUTFIT_TOPS,
    noun: 'outfit',
  },
};
export const MILESTONE_KINDS: MilestoneKind[] = ['lv3', 'lv6', 'lv10', 'lv15', 'lv20', 'lv30'];
/** A catalogue item's milestone, from its set name ("Level 10"). */
export const milestoneOfSet = (set: string): MilestoneKind | null => MILESTONE_KINDS.find((k) => MILESTONE[k].title === set) ?? null;

export interface CertStatus {
  eligible: boolean;
  reason?: 'not-a-gali-miner' | 'no-beta-rounds' | null;
  rounds: number;
  firstAt: string | null;
  name: string | null;
  claim: CertClaim | null;
  /** the mint is set up on the server (collection and authority) */
  open: boolean;
  /** the server is still reading this wallet's history */
  counting?: boolean;
  /** the milestone certificates (null when the server could not read them) */
  milestones?: Milestones | null;
  /** the claim fee per certificate in SOL, paid in the mint transaction (0 = none) */
  fee?: number;
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
  /** which certificate is being claimed */
  claimKind: ClaimKind | null;
  error: string | null;
  /** the asset just minted, for the celebration */
  minted: string | null;
  refresh: (wallet: string | null, force?: boolean) => Promise<void>;
  claim: (kind?: ClaimKind) => Promise<void>;
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
  claimKind: null,
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
      // the two answers stand alone: a slow Founding Miner check never hides the NFTs the wallet holds
      const [st, inv] = await Promise.all([
        call<CertStatus>({ a: 'status', wallet }).then((c) => ({ c, e: null as string | null }), (e) => ({ c: null, e: (e as Error).message })),
        call<{ items: InvItem[] }>({ a: 'inventory', wallet }).then((r) => ({ items: r.items, e: null as string | null }), (e) => ({ items: [] as InvItem[], e: (e as Error).message })),
      ]);
      if (get().wallet !== wallet) return;
      set({ cert: st.c ?? get().cert, items: inv.items, loading: false, error: inv.e ? `Couldn't read your NFTs (${inv.e})` : null });
      // the server was busy: try the Founding Miner check again shortly
      if (!st.c) {
        setTimeout(() => void get().refresh(wallet, true), 30_000);
        return;
      }
      const cert = st.c;
      // a long mining history is read over several calls: ask again shortly
      if (cert.counting) setTimeout(() => void get().refresh(wallet, true), 25_000);
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

  async claim(kind = 'founding') {
    const wallet = get().wallet;
    if (!wallet || get().claiming) return;
    const ms = kind === 'founding' ? null : kind;
    set({ error: null, claimKind: kind });
    try {
      let pass = useDm.getState().me === wallet ? useDm.getState().pass : null;
      if (!pass) {
        set({ claiming: 'signing-in' });
        await signIn();
        pass = useDm.getState().pass;
        if (!pass) throw new Error('Sign-in was not completed');
      }
      set({ claiming: 'building' });
      const built = await call<{ tx: string; asset: string; serial: number; lastValidBlockHeight: number }>({ a: 'build', pass, ...(ms ? { kind: ms } : {}) });
      set({ claiming: 'wallet' });
      const chain = await loadChain();
      const sig = await chain.sendPrebuilt(b64ToBytes(built.tx), built.lastValidBlockHeight);
      set({ claiming: 'confirming' });
      // the chain has it; give the server's read a few tries to catch up
      for (let k = 0; k < 6; k++) {
        const r: { claim?: { status: string }; pending?: boolean } = await call<{ claim?: { status: string }; pending?: boolean }>({ a: 'confirm', pass, sig, ...(ms ? { kind: ms } : {}) }).catch(() => ({ pending: true }));
        if (r.claim?.status === 'minted') break;
        await wait(2500);
      }
      set({ claiming: null, claimKind: null, ...(ms ? {} : { minted: built.asset }) });
      play('levelup');
      const serial = String(built.serial).padStart(4, '0');
      useGame.getState().toast(ms ? `${MILESTONE[ms].title} Certificate #${serial} is in your wallet` : `Founding Miner #${serial} is in your wallet`, 'gold');
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
