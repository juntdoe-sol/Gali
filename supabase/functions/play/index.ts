// Gali play records: everything the game saves about a wallet goes through here, signed in with the same pass as
// messages (../_shared/pass.ts). The tables are closed to the public key (sql/signed-reports.sql), so a player can
// only ever write for their own wallet, and numbers the server can check it works out itself
// (sql/verified-scores.sql).
//
// Calls (POST, JSON body with `a` for the action and `pass`):
//   seen   { name }                     check in this wallet's name; level, XP and points are the server's own
//   round  { round }                    score a finished live round, read from ORE's own Round and Miner accounts
//   bonus  { n }                        XP from fights, quests and the like: at most 100 a report, 600 a day
//   cave   { n }                        Cave Run XP: its own pool, at most 100 a report, 400 a day
//   ore    {}                           write down this wallet's lifetime ORE mined, read from ORE's Miner account
//   ko     { killer, scope }            this wallet was knocked out by `killer` (a wallet)
//   win    { mode, players }            this wallet won an arena match or a raid
//   chat   { mid, sender, name, body }  save one of this wallet's lobby chat lines
//   ticket { id }                       a signed arena ticket for this wallet and player id (see below)
//   fight  { mid, mode, ord }           Gali Fightclub: this wallet's view of an online match's finishing order
//                                       (wallets, 1st first). Ranks change once every wallet in it agrees (below).
//   tip     { body }                    University of ORE: share a mining tip (8-200 characters, 3 a day, no links;
//                                       needs a Gali name). sql/uni-tips.sql
//   tipvote { id, kind }                upvote ('up') or report ('report') someone else's tip, once each
//   rename  { name, sig? }              change this wallet's Gali name: free once every 30 days, sooner needs `sig`,
//                                       a confirmed transfer of 0.1 SOL to Gali's revenue wallet (sql/name-change.sql)
//   cards   {}                          this wallet's Mining Cards: unused ones it bought, and ones it redeemed
//   skills  {}                          this wallet's NUGS (in-game coin) and the Fight Club skills it owns
//   buyskill { skill }                  buy a skill with NUGS (sql/nugs-skills.sql)
//   redeem  { code }                    use a Mining Card code: XP and the pack now, then the card's SOL from Gali's
//                                       house wallet (sql/mining-cards.sql)
// Deploy: npx supabase functions deploy play
// Secrets: DM_SECRET (shared with dm), SOLANA_RPC, TICKET_KEY (32-byte ed25519 seed, hex; see scripts/ticket-key.mjs)
//
// Arena tickets: only a wallet that has played ORE (its ORE Miner account exists, which costs real SOL to create)
// gets one. The app pins the ticket key's public half, so only tickets from here count, and the arena host is
// chosen among ticketed players by a hash nobody can steer (app/src/game/arena.ts).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@2.4.0/ed25519.js';
import { isWallet, readPass } from '../_shared/pass.ts';
import { readMinerRound } from '../_shared/ore.ts';
import { scoreRound } from '../_shared/score.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

/**
 * Gali counts ORE and SOL from when a wallet joined (supabase/sql/gali-since-join.sql): the first check-in writes
 * down ORE's lifetime counters as the wallet's baseline. A wallet that never mined on ORE starts at zero.
 */
async function setBase(wallet: string) {
  const { data } = await db.from('gali_miners').select('ore_base, sol_in_base, sol_back_base').eq('wallet', wallet).maybeSingle();
  if (!data || (data.ore_base !== null && data.sol_in_base !== null && data.sol_back_base !== null)) return;
  const { miner } = await readMinerRound(wallet);
  const ore = miner ? Number(miner.lifetimeRewardsOre) / 1e11 : 0;
  const solIn = miner ? Number(miner.lifetimeDeployed) / 1e9 : 0;
  const solBack = miner ? Number(miner.lifetimeRewardsSol) / 1e9 : 0;
  await db.rpc('gali_set_base', { p_wallet: wallet, p_ore: ore, p_sol_in: solIn, p_sol_back: solBack });
}
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
function fail(e: unknown) {
  console.error('play', (e as Error)?.message ?? e);
  return reply(500, { error: 'Something went wrong. Try again.' });
}
const cleanName = (n: unknown) => String(n ?? '').replace(/[^A-Za-z0-9 _.-]/g, '').trim().slice(0, 14);
const cleanBody = (b: unknown) => String(b ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80);
const int = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
const SCOPES = new Set(['lobby', 'island', 'arena']);

/* ---------- paid renames: 0.1 SOL to Gali's revenue wallet, checked on chain ---------- */
const REVENUE_WALLET = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
const NAME_FEE = 100_000_000; // lamports
async function solRpc(method: string, params: unknown[]) {
  const url = Deno.env.get('SOLANA_RPC');
  if (!url) throw new Error('SOLANA_RPC is not set');
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
type ParsedIx = { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string; lamports?: number } } };
/** Lamports `wallet` sent to the revenue wallet in transaction `sig` (confirmed, no error, under an hour old), or an error. */
async function namePayment(sig: string, wallet: string): Promise<number | string> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(sig)) return 'That payment does not look right.';
  let tx: { blockTime?: number; meta?: { err?: unknown }; transaction?: { message?: { instructions?: ParsedIx[] } } } | null = null;
  for (let i = 0; i < 4 && !tx; i++) {
    tx = await solRpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]);
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!tx) return 'The payment is not on chain yet. Wait a moment and try again.';
  if (tx.meta?.err) return 'That payment failed on chain.';
  if (!tx.blockTime || Date.now() / 1000 - tx.blockTime > 3600) return 'That payment is too old. Pay again to rename.';
  let paid = 0;
  for (const ix of tx.transaction?.message?.instructions ?? []) {
    const info = ix.parsed?.info;
    if (ix.program === 'system' && ix.parsed?.type === 'transfer' && info?.source === wallet && info?.destination === REVENUE_WALLET) paid += Number(info.lamports) || 0;
  }
  return paid >= NAME_FEE ? paid : 'That payment is not 0.1 SOL from your wallet to Gali.';
}
const MODES = new Set(['lms', 'koth', 'boss', 'waves']);
const TICKET_MS = 60 * 60_000;
/** The text a ticket signs; the app checks the same text (app/src/game/ticket.ts). */
export const ticketText = (wallet: string, id: string, exp: number) => `gali-ticket|${wallet}|${id}|${exp}`;

function ticketKey(): Uint8Array | null {
  const hex = Deno.env.get('TICKET_KEY') ?? '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))) : null;
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

/**
 * Gali Fightclub: once every wallet in a match has reported, and all name the same order, the ratings move.
 * Elo between every pair (the better finisher wins the pair), K = 32 shared across the pairs; a pair that already
 * played 5 rated matches today does not count. Reports that disagree settle the match with no change.
 */
async function settleFight(mid: string, players: string[]) {
  const { data: reps } = await db.from('fc_reports').select('wallet, ord').eq('mid', mid);
  if (!reps || reps.length < players.length) return;
  // claim it, so two last reports arriving together settle it once
  const { data: claimed } = await db.from('fc_matches').update({ settled: true }).eq('mid', mid).eq('settled', false).select('mid');
  if (!claimed?.length) return;
  const first = (reps[0].ord as string[]).join();
  if (!reps.every((r) => (r.ord as string[]).join() === first)) return;
  const ord = reps[0].ord as string[];
  const { data: rows } = await db.from('fc_ratings').select('wallet, rating, games, wins').in('wallet', ord);
  const cur = new Map((rows ?? []).map((r) => [r.wallet as string, r]));
  const R = (w: string) => Number(cur.get(w)?.rating ?? 1000);
  const delta = new Map(ord.map((w) => [w, 0]));
  const K = 32 / (ord.length - 1);
  for (let i = 0; i < ord.length; i++) {
    for (let j = i + 1; j < ord.length; j++) {
      const { data: n } = await db.rpc('fc_pair_count', { p_a: ord[i], p_b: ord[j] });
      if (Number(n ?? 0) >= 5) continue;
      const e = 1 / (1 + 10 ** ((R(ord[j]) - R(ord[i])) / 400));
      delta.set(ord[i], delta.get(ord[i])! + K * (1 - e));
      delta.set(ord[j], delta.get(ord[j])! - K * (1 - e));
    }
  }
  const now = new Date().toISOString();
  const ratings = ord.map((w, k) => {
    const c = cur.get(w);
    return { wallet: w, rating: Math.max(100, Math.round(R(w) + delta.get(w)!)), games: Number(c?.games ?? 0) + 1, wins: Number(c?.wins ?? 0) + (k === 0 ? 1 : 0), at: now };
  });
  const up = await db.from('fc_ratings').upsert(ratings, { onConflict: 'wallet' });
  if (up.error) throw up.error;
  const res = await db.from('fc_results').insert(ratings.map((r, k) => ({ mid, wallet: r.wallet, place: k + 1, delta: r.rating - R(r.wallet), rating: r.rating })));
  if (res.error) throw res.error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 2000) return reply(413, { error: 'too big' });
    const q = await req.json();
    const me = await readPass(q?.pass);
    if (!me) return reply(401, { error: 'Sign in again' });
    const a = String(q.a ?? '');

    if (a === 'seen') {
      const { error } = await db.rpc('gali_checkin', { p_wallet: me, p_name: cleanName(q.name) });
      if (error) return fail(error);
      await setBase(me).catch((e) => console.error('base', (e as Error)?.message ?? e));
      return reply(200, { ok: true });
    }
    if (a === 'rename') {
      const name = cleanName(q.name);
      if (name.length < 2) return reply(400, { error: 'Use 2 to 14 letters, numbers, spaces, dots, dashes or underscores.' });
      const sig = q.sig ? String(q.sig) : null;
      let lamports = 0;
      if (sig) {
        const p = await namePayment(sig, me);
        if (typeof p === 'string') return reply(400, { error: p });
        lamports = p;
      }
      const { data, error } = await db.rpc('gali_rename', { p_wallet: me, p_name: name, p_sig: sig, p_lamports: lamports });
      if (error) return fail(error);
      if (data === 'pay') {
        const { data: m } = await db.from('gali_miners').select('name_changed_at').eq('wallet', me).maybeSingle();
        const next = m?.name_changed_at ? new Date(new Date(m.name_changed_at).getTime() + 30 * 86_400_000).toISOString() : null;
        return reply(402, { pay: true, lamports: NAME_FEE, to: REVENUE_WALLET, next });
      }
      if (data === 'used') return reply(400, { error: 'That payment was already used for a rename.' });
      if (data !== 'ok' && data !== 'same') return reply(400, { error: 'Could not change the name.' });
      return reply(200, { ok: true, name });
    }
    if (a === 'skills') {
      const [n, owned] = await Promise.all([db.rpc('gali_nugs', { p_wallet: me }), db.from('gali_skills').select('skill').eq('wallet', me)]);
      if (n.error || owned.error) return fail(n.error ?? owned.error);
      return reply(200, { ok: true, nugs: Number(n.data ?? 0), owned: (owned.data ?? []).map((r: { skill: string }) => r.skill) });
    }
    if (a === 'buyskill') {
      const skill = String(q.skill ?? '');
      if (!/^[a-z]{3,12}$/.test(skill)) return reply(400, { error: 'No such skill.' });
      const { data, error } = await db.rpc('gali_buy_skill', { p_wallet: me, p_skill: skill });
      if (error) return fail(error);
      if (data === 'short') return reply(400, { error: 'Not enough NUGS yet. Play rounds and fights to earn more.' });
      if (data === 'unknown') return reply(400, { error: 'That skill is not for sale.' });
      const { data: n } = await db.rpc('gali_nugs', { p_wallet: me });
      return reply(200, { ok: true, skill, nugs: Number(n ?? 0), owned: data === 'owned' });
    }
    if (a === 'cards') {
      const [mine, used] = await Promise.all([
        db.from('mining_cards').select('code, value, sol_lamports, bought_at').eq('owner', me).eq('status', 'unused').order('bought_at', { ascending: false }).limit(50),
        db.from('mining_cards').select('code, value, sol_lamports, redeemed_at, payout_sig').eq('redeemed_by', me).order('redeemed_at', { ascending: false }).limit(20),
      ]);
      if (mine.error || used.error) return fail(mine.error ?? used.error);
      return reply(200, { ok: true, unused: mine.data, redeemed: used.data });
    }
    if (a === 'redeem') {
      const code = String(q.code ?? '').toUpperCase();
      if (!/^GALI-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) return reply(400, { error: 'That code does not look right. It reads GALI-XXXX-XXXX-XXXX.' });
      const { data, error } = await db.rpc('mining_card_redeem', { p_wallet: me, p_code: code });
      if (error) return fail(error);
      if (data?.error === 'used') return reply(400, { error: 'This card was already used.' });
      if (data?.error) return reply(400, { error: 'No card has that code.' });
      return reply(200, { ok: true, code, value: data.value, sol_lamports: data.sol_lamports, rewards: data.rewards, payout: null });
    }
    if (a === 'round') {
      const round = BigInt(int(q.round, 0, Number.MAX_SAFE_INTEGER));
      const { current, miner, round: r } = await readMinerRound(me);
      // ORE's miner only holds its last round: a round already replaced by a newer deploy can't be checked any more
      if (!miner || miner.roundId !== round || round >= current || !r || r.id !== round) return reply(200, { ok: false, reason: 'not checkable' });
      const s = scoreRound(miner.deployed, r.entropy, r.motherlode);
      if (!s) return reply(200, { ok: false, reason: 'nothing to score' });
      const { data, error } = await db.rpc('gali_score_round', { p_wallet: me, p_round: Number(round), p_covered: s.covered, p_won: s.won, p_motherlode: s.motherlode, p_points: s.points, p_xp: s.xp });
      return error ? fail(error) : reply(200, { ok: true, scored: data === true, ...s });
    }
    if (a === 'bonus') {
      const { data, error } = await db.rpc('gali_bonus_xp', { p_wallet: me, p_n: int(q.n, 0, 100) });
      return error ? fail(error) : reply(200, { ok: true, added: data ?? 0 });
    }
    if (a === 'cave') {
      const { data, error } = await db.rpc('gali_cave_xp', { p_wallet: me, p_n: int(q.n, 0, 100) });
      return error ? fail(error) : reply(200, { ok: true, added: data ?? 0 });
    }
    if (a === 'ore') {
      const { miner } = await readMinerRound(me);
      if (!miner) return reply(200, { ok: false });
      const ore = Number(miner.lifetimeRewardsOre) / 1e11;
      const { error } = await db.rpc('gali_ore_seen', { p_wallet: me, p_ore: Math.round(ore * 1e6) / 1e6 });
      return error ? fail(error) : reply(200, { ok: true });
    }
    if (a === 'ticket') {
      const key = ticketKey();
      if (!key) return reply(503, { error: 'Arena tickets are off' });
      const id = String(q.id ?? '');
      if (!/^[1-9A-HJ-NP-Za-km-z]{8}[a-z0-9]{4}$/.test(id) || !id.startsWith(me.slice(0, 8))) return reply(400, { error: 'bad id' });
      const { miner } = await readMinerRound(me);
      if (!miner) return reply(403, { error: 'Play one live round to host arena matches' });
      const exp = Date.now() + TICKET_MS;
      const sig = ed25519.sign(new TextEncoder().encode(ticketText(me, id, exp)), key);
      return reply(200, { ok: true, exp, sig: b64(sig) });
    }
    if (a === 'ko') {
      if (!isWallet(q.killer) || q.killer === me || !SCOPES.has(q.scope)) return reply(400, { error: 'bad report' });
      const { error } = await db.from('brawl_kos').insert({ killer: q.killer, victim: me, scope: q.scope });
      return error ? fail(error) : reply(200, { ok: true });
    }
    if (a === 'win') {
      const players = int(q.players, 1, 12);
      if (!MODES.has(q.mode) || (players < 2 && q.mode !== 'boss' && q.mode !== 'waves')) return reply(400, { error: 'bad report' });
      const { error } = await db.from('brawl_wins').insert({ winner: me, host: me, mode: q.mode, players });
      return error ? fail(error) : reply(200, { ok: true });
    }
    if (a === 'fight') {
      const mid = String(q.mid ?? '');
      const mode = q.mode === '1v1' || q.mode === 'ffa' ? q.mode : null;
      const ord: string[] = Array.isArray(q.ord) ? q.ord.map((w: unknown) => String(w)) : [];
      if (!/^[A-Za-z0-9-]{6,64}$/.test(mid) || !mode || ord.length < 2 || ord.length > 4 || !ord.every(isWallet) || new Set(ord).size !== ord.length || !ord.includes(me)) return reply(400, { error: 'bad report' });
      const { count } = await db.from('fc_reports').select('mid', { count: 'exact', head: true }).eq('wallet', me).gt('at', new Date(Date.now() - 86_400_000).toISOString());
      if ((count ?? 0) >= 120) return reply(200, { ok: false, reason: 'daily limit' });
      const players = [...ord].sort();
      // the first report fixes who was in the match; later ones must name the same wallets
      const ins = await db.from('fc_matches').upsert({ mid, mode, players }, { onConflict: 'mid', ignoreDuplicates: true });
      if (ins.error) return fail(ins.error);
      const { data: m, error } = await db.from('fc_matches').select('players, settled, at, mode').eq('mid', mid).single();
      if (error || !m) return fail(error);
      if ((m.players as string[]).join() !== players.join() || m.mode !== mode) return reply(200, { ok: false, reason: 'players differ' });
      if (Date.now() - Date.parse(m.at) > 15 * 60_000) return reply(200, { ok: false, reason: 'too late' });
      const rep = await db.from('fc_reports').upsert({ mid, wallet: me, ord }, { onConflict: 'mid,wallet', ignoreDuplicates: true });
      if (rep.error) return fail(rep.error);
      if (!m.settled) await settleFight(mid, players).catch((e) => console.error('settle', (e as Error)?.message ?? e));
      const { data: mine } = await db.from('fc_results').select('delta, rating, place').eq('mid', mid).eq('wallet', me).maybeSingle();
      return reply(200, { ok: true, settled: Boolean(mine), ...(mine ?? {}) });
    }
    if (a === 'tip') {
      const body = String(q.body ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (body.length < 8 || body.length > 200) return reply(400, { error: 'Tips are 8 to 200 characters.' });
      if (/https?:|www\.|\.(com|io|xyz|gg|lol|app|net|org)\b|t\.me\//i.test(body)) return reply(400, { error: 'No links in tips.' });
      const { data: miner } = await db.from('gali_miners').select('name').eq('wallet', me).maybeSingle();
      const name = cleanName(miner?.name);
      if (!name) return reply(403, { error: 'Pick a Gali name first.' });
      const { count } = await db.from('gali_uni_tips').select('id', { count: 'exact', head: true }).eq('wallet', me).gt('at', new Date(Date.now() - 86_400_000).toISOString());
      if ((count ?? 0) >= 3) return reply(429, { error: 'That is 3 tips today. Share more tomorrow.' });
      const { data, error } = await db.from('gali_uni_tips').insert({ wallet: me, name, body }).select('id').single();
      return error ? fail(error) : reply(200, { ok: true, id: data.id });
    }
    if (a === 'tipvote') {
      const id = int(q.id, 1, Number.MAX_SAFE_INTEGER);
      const kind = q.kind === 'up' || q.kind === 'report' ? q.kind : null;
      if (!kind) return reply(400, { error: 'bad vote' });
      const { data: tip } = await db.from('gali_uni_tips').select('wallet').eq('id', id).maybeSingle();
      if (!tip) return reply(404, { error: 'That tip is gone.' });
      if (tip.wallet === me) return reply(400, { error: 'That one is yours.' });
      const { data, error } = await db.rpc('gali_tip_vote', { p_tip: id, p_wallet: me, p_kind: kind });
      return error ? fail(error) : reply(200, { ok: true, counted: data === true });
    }
    if (a === 'chat') {
      const mid = String(q.mid ?? '');
      const sender = String(q.sender ?? '');
      const name = cleanName(q.name);
      const body = cleanBody(q.body);
      if (!/^[a-z0-9-]{4,40}$/.test(mid) || sender.length < 1 || sender.length > 16 || name.length < 2 || !body) return reply(400, { error: 'bad line' });
      const { error } = await db.from('lobby_chat').insert({ mid, sender, name, body, wallet: me });
      return error ? fail(error) : reply(200, { ok: true });
    }
    return reply(400, { error: 'unknown action' });
  } catch (e) {
    return fail(e);
  }
});
