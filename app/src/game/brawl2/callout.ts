/**
 * Gali Fightclub callouts: challenge Gali miners by name, or a friend on X by their handle.
 *
 *  - 1v1: one rival, a Gali miner or a friend on X. Free for all: up to 3 online Gali miners with a wallet (4 with you).
 *  - Fight now, or set a time: then nobody waits in the room. At the time everyone gets a FIGHT popup, and the
 *    room starts by itself when all are in (a free for all also starts 2 minutes after the first two arrive).
 *  - Gali miners who are online hear it at once (the chat room, game/lobby.ts `shoutCallout`). With wallets on
 *    both sides it also arrives as a DM, so a miner who is away sees it next time.
 *  - A friend on X gets a post with the link `?fight=CODE&t=TIME&n=PLAYERS`, which opens Gali and walks them in.
 *  - The caller gets a card (PNG) to post: their miner against the rival, the time, the room code and the link.
 */
import { create } from 'zustand';
import { cleanName } from '../lobbyMap';
import { dmTo, useDm } from '../dm';
import { calloutHooks, shoutCallout, useLobby } from '../lobby';
import { loadJson, saveJson } from '../storage';
import { useGame } from '../store';
import { useName } from '../username';
import { publicKey, restBase } from '../world';

const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
/** a callout stays open this long after its time */
export const CALLOUT_MS = 30 * 60_000;
/** the FIGHT popup comes this long before the time */
const EARLY_MS = 60_000;
export const WEB_BASE = 'https://betatest.gali.lol';

export interface Rival {
  name: string;
  wallet: string | null;
  /** an X handle (without @), for friends who are not in Gali yet */
  x?: string;
  online?: boolean;
  level?: number;
}
/** A fight someone called: yours, or one you were called to. */
export interface Fight {
  code: string;
  /** when it starts (ms) */
  at: number;
  /** players in it, you included: 2 (1v1) to 4 (free for all) */
  n: number;
  /** who called it, and who was called */
  from: string;
  rivals: string[];
  mine: boolean;
}
interface CalloutState {
  /** a FIGHT popup: someone called you out, or your own callout's time came */
  incoming: Fight | null;
  /** fights later on (saved on this device) */
  later: Fight[];
  /** a room to walk into when the Fightclub opens */
  join: Fight | null;
  /** your callout being set up or waited on, with its rivals (for the card) */
  mine: { fight: Fight; rivals: Rival[] } | null;
}
const LATER_KEY = 'gali-callouts-v1';
export const useCallout = create<CalloutState>(() => ({ incoming: null, later: [], join: null, mine: null }));
// saved fights, merged with any a ?fight= link added while this was loading
void loadJson<Fight[]>(LATER_KEY, []).then((l) => {
  const saved = (Array.isArray(l) ? l : []).filter((f) => f && typeof f.code === 'string' && Date.now() - f.at < CALLOUT_MS);
  const now = useCallout.getState().later;
  useCallout.setState({ later: [...saved.filter((f) => !now.some((x) => x.code === f.code)), ...now] });
});
const saveLater = (later: Fight[]) => {
  useCallout.setState({ later });
  saveJson(LATER_KEY, later, 0);
};

const CODE = /^[A-HJ-NP-Z]{4}$/;
export const fightLink = (f: Pick<Fight, 'code' | 'at' | 'n'>) => `${WEB_BASE}/?fight=${f.code}&t=${Math.round(f.at / 60_000)}&n=${f.n}`;

/** "9:30 PM GMT+8": a time with the zone it is in, for posts other people read. */
export function fmtWhen(at: number, withZone = true) {
  const d = new Date(at);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = new Date().toDateString() === d.toDateString() ? '' : ` ${d.toLocaleDateString([], { weekday: 'short' })}`;
  if (!withZone) return t + day;
  const off = -d.getTimezoneOffset() / 60;
  return `${t}${day} GMT${off >= 0 ? '+' : ''}${Number.isInteger(off) ? off : off.toFixed(1)}`;
}

/** A ?fight=CODE link opened the game: walk in now, or keep it for later. */
export function readFightLink() {
  if (typeof window === 'undefined' || !window.location) return;
  const q = new URLSearchParams(window.location.search ?? '');
  const code = (q.get('fight') ?? '').toUpperCase();
  if (!CODE.test(code)) return;
  const t = Number(q.get('t'));
  const at = t > 0 ? t * 60_000 : Date.now();
  const n = Math.max(2, Math.min(4, Number(q.get('n')) || 2));
  if (Date.now() - at > CALLOUT_MS) return;
  arrive({ code, at, n, from: 'Your challenger', rivals: [], mine: false });
}

/** A fight you are in: the popup now if it is time, else saved for later. */
function arrive(f: Fight) {
  if (f.at - Date.now() <= EARLY_MS) useCallout.setState({ incoming: f });
  else if (!useCallout.getState().later.some((x) => x.code === f.code)) saveLater([...useCallout.getState().later, f]);
}
/** Called every few seconds: a saved fight whose time has come pops up. */
export function checkLater() {
  const now = Date.now();
  const { later, incoming } = useCallout.getState();
  const due = later.find((f) => f.at - now <= EARLY_MS);
  const keep = later.filter((f) => f !== due && now - f.at < CALLOUT_MS);
  if (due || keep.length !== later.length) saveLater(keep);
  if (due && !incoming) useCallout.setState({ incoming: due });
}

/** Miners to call out: the ones online now first, then Gali miners by name. `walletOnly`: free for all. */
export async function findRivals(q: string, walletOnly = false): Promise<Rival[]> {
  const term = cleanName(q).toLowerCase();
  const me = useGame.getState().wallet.owner;
  const myName = (useName.getState().name ?? '').toLowerCase();
  const out = new Map<string, Rival>();
  for (const p of Object.values(useLobby.getState().peers)) {
    const w = p.wallet && B58.test(p.wallet) ? p.wallet : null;
    if (!p.name || p.name.toLowerCase() === myName || (term && !p.name.toLowerCase().includes(term)) || (walletOnly && !w) || (w && w === me)) continue;
    out.set(w ?? `n:${p.name.toLowerCase()}`, { name: p.name, wallet: w, online: true, level: p.lvl });
  }
  const base = restBase();
  if (!walletOnly && base && term.length >= 2) {
    try {
      const r = await fetch(`${base}/rest/v1/gali_miners?select=wallet,name,level&name=ilike.${encodeURIComponent(term)}*&order=xp.desc&limit=8`, { headers: { apikey: publicKey(), authorization: `Bearer ${publicKey()}` } });
      if (r.ok) {
        for (const m of (await r.json()) as { wallet: string; name: string; level: number }[]) {
          if (!m.name || m.wallet === me || out.has(m.wallet)) continue;
          out.set(m.wallet, { name: m.name, wallet: m.wallet, online: false, level: m.level });
        }
      }
    } catch {
      /* online miners only */
    }
  }
  return [...out.values()].slice(0, 10);
}

/** Make a callout: your own copy (saved if it is later), and the word to each Gali rival. */
export async function sendCallout(fight: Fight, rivals: Rival[]): Promise<{ reached: number; of: number }> {
  useCallout.setState({ mine: { fight, rivals } });
  if (fight.at - Date.now() > EARLY_MS) saveLater([...useCallout.getState().later.filter((f) => f.code !== fight.code), fight]);
  const from = useName.getState().name || 'A miner';
  const fw = useGame.getState().wallet.owner;
  const gali = rivals.filter((r) => !r.x);
  let reached = 0;
  for (const r of gali) {
    const live = shoutCallout({ from, fw: fw && B58.test(fw) ? fw : null, to: r.name, tw: r.wallet, code: fight.code, at: fight.at, n: fight.n });
    let dm = false;
    const when = fight.at - Date.now() > EARLY_MS ? ` at ${fmtWhen(fight.at)}` : '';
    const kind = fight.n > 2 ? 'a free for all' : 'a 1v1';
    if (r.wallet) dm = await dmTo(r.wallet, `GALI FIGHTCLUB CALLOUT: ${from} called you out to ${kind}${when}. Room ${fight.code}. Fight: ${fightLink(fight)}`);
    if (live || dm) reached++;
  }
  return { reached, of: gali.length };
}

/** The X post for a callout (the card is saved and attached by the player). */
export function xPostText(rivals: Rival[], fight: Fight) {
  const who = rivals.map((r) => (r.x ? `@${r.x}` : r.name)).join(' ');
  const when = fight.at - Date.now() > EARLY_MS ? ` at ${fmtWhen(fight.at)}` : ' right now';
  return `${who} I'm calling you out. Gali Fightclub ${fight.n > 2 ? 'free for all' : '1v1'}${when}, room ${fight.code}. Come fight me:`;
}

/* ---------------- hearing callouts ---------------- */

calloutHooks.heard = (p: unknown) => {
  const x = p as { from?: unknown; to?: unknown; tw?: unknown; code?: unknown; at?: unknown; n?: unknown };
  if (!x || typeof x.code !== 'string' || !CODE.test(x.code)) return;
  const meW = useGame.getState().wallet.owner;
  const meN = (useName.getState().name ?? '').toLowerCase();
  const forMe = typeof x.tw === 'string' && x.tw ? x.tw === meW : typeof x.to === 'string' && meN && x.to.toLowerCase() === meN;
  if (!forMe) return;
  const at = typeof x.at === 'number' && x.at > 0 && x.at < Date.now() + 7 * 86_400_000 ? x.at : Date.now();
  arrive({ code: x.code, at, n: Math.max(2, Math.min(4, Number(x.n) || 2)), from: cleanName(x.from) || 'A miner', rivals: [], mine: false });
};

/** A callout DM that came while you were away. */
const seenDm = new Set<string>();
useDm.subscribe((s, prev) => {
  if (s.threads === prev.threads) return;
  for (const t of s.threads) {
    if (!t.unread || typeof t.last !== 'string') continue;
    const m = /GALI FIGHTCLUB CALLOUT: (.{1,20}?) called you out.*Room ([A-Z]{4}).*fight=[A-Z]{4}&t=(\d+)&n=(\d)/.exec(t.last);
    if (!m || seenDm.has(m[2])) continue;
    seenDm.add(m[2]);
    const at = Number(m[3]) * 60_000;
    if (Date.now() - at > CALLOUT_MS) continue;
    arrive({ code: m[2], at, n: Number(m[4]) || 2, from: cleanName(m[1]) || t.name || 'A miner', rivals: [], mine: false });
  }
});
