// Gali play records: everything the game saves about a wallet goes through here, signed in with the same pass as
// messages (../_shared/pass.ts). The tables are closed to the public key (sql/signed-reports.sql), so a player can
// only ever write for their own wallet, and numbers the server can check it works out itself
// (sql/verified-scores.sql).
//
// Calls (POST, JSON body with `a` for the action and `pass`):
//   seen   { name }                     check in this wallet's name; level, XP and points are the server's own
//   round  { round }                    score a finished live round, read from ORE's own Round and Miner accounts
//   bonus  { n }                        XP from fights, quests and the like: at most 100 a report, 600 a day
//   ore    {}                           write down this wallet's lifetime ORE mined, read from ORE's Miner account
//   ko     { killer, scope }            this wallet was knocked out by `killer` (a wallet)
//   win    { mode, players }            this wallet won an arena match or a raid
//   chat   { mid, sender, name, body }  save one of this wallet's lobby chat lines
//   ticket { id }                       a signed arena ticket for this wallet and player id (see below)
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
const MODES = new Set(['lms', 'koth', 'boss', 'waves']);
const TICKET_MS = 60 * 60_000;
/** The text a ticket signs; the app checks the same text (app/src/game/ticket.ts). */
export const ticketText = (wallet: string, id: string, exp: number) => `gali-ticket|${wallet}|${id}|${exp}`;

function ticketKey(): Uint8Array | null {
  const hex = Deno.env.get('TICKET_KEY') ?? '';
  return /^[0-9a-f]{64}$/i.test(hex) ? Uint8Array.from(hex.match(/../g)!.map((h) => parseInt(h, 16))) : null;
}
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

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
      return error ? fail(error) : reply(200, { ok: true });
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
