// Gali play records: everything the game saves about a wallet goes through here, signed in with the same pass as
// messages (../_shared/pass.ts). The tables are closed to the public key (sql/signed-reports.sql), so a player can
// only ever write for their own wallet.
//
// Calls (POST, JSON body with `a` for the action and `pass`):
//   seen  { name, level, xp, points }  check in this wallet's name and progress (only rises are kept)
//   ore   { ore }                      this wallet's lifetime ORE mined, as read from ORE's Miner account
//   ko    { killer, scope }            this wallet was knocked out by `killer` (a wallet)
//   win   { mode, players }            this wallet won an arena match or a raid
//   chat  { mid, sender, name, body }  save one of this wallet's lobby chat lines
// Deploy: npx supabase functions deploy play  (secret DM_SECRET, shared with dm)
import { createClient } from 'npm:@supabase/supabase-js@2';
import { isWallet, readPass } from '../_shared/pass.ts';

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
      const { error } = await db.rpc('gali_seen', { p_wallet: me, p_name: cleanName(q.name), p_level: int(q.level, 1, 200), p_xp: int(q.xp, 0, 50_000_000), p_points: int(q.points, 0, 500_000_000) });
      return error ? fail(error) : reply(200, { ok: true });
    }
    if (a === 'ore') {
      const ore = Number(q.ore);
      if (!(ore >= 0 && ore <= 100_000_000)) return reply(400, { error: 'bad value' });
      const { error } = await db.rpc('gali_ore_seen', { p_wallet: me, p_ore: Math.round(ore * 1e6) / 1e6 });
      return error ? fail(error) : reply(200, { ok: true });
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
