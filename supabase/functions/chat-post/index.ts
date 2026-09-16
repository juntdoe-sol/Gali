// Gali miners chat: accepts a message only if it is signed by the sender's active
// on-chain session key (Player.session in the Gali program), then stores it.
// Tip messages must reference a confirmed SKR transfer from the sender to the recipient.
// Wallets muted by the admin (chat-admin) can't post.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, readPlayer, reply, tipIsReal, verify } from '../_shared/solana.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const short = (k: string) => `${k.slice(0, 4)}…${k.slice(-4)}`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const { wallet, session, body, ts, sig, room = 'global', tip } = await req.json();
    const text = String(body ?? '').trim().slice(0, 280);
    if (!wallet || !session || !sig || !text) return reply(400, { error: 'missing fields' });
    if (Math.abs(Date.now() - Number(ts)) > 60_000) return reply(400, { error: 'stale message' });
    if (!verify(String(sig), `gali-chat:${room}:${wallet}:${ts}:${text}`, String(session))) return reply(401, { error: 'bad signature' });

    const { data: muted } = await db.from('muted_wallets').select('wallet').eq('wallet', wallet).maybeSingle();
    if (muted) return reply(403, { error: 'You are muted in the miners chat' });

    const player = await readPlayer(wallet);
    if (!player) return reply(403, { error: 'play one round on-chain to join the chat' });
    if (player.session !== session || player.expires * 1000 < Date.now()) return reply(403, { error: 'session expired; start a new one' });

    const { data: last } = await db.from('messages').select('created_at').eq('wallet', wallet).order('created_at', { ascending: false }).limit(1);
    if (!tip && last?.[0] && Date.now() - new Date(last[0].created_at).getTime() < 2000) return reply(429, { error: 'slow down' });

    const row: Record<string, unknown> = { room, wallet, name: short(wallet), level: player.level, body: text, kind: 'msg' };
    if (tip) {
      const amount = Number(tip.amount);
      if (!tip.to || !tip.sig || !(amount > 0)) return reply(400, { error: 'bad tip' });
      if (!(await tipIsReal(tip.sig, wallet, tip.to, amount))) return reply(400, { error: 'tip transaction not found' });
      Object.assign(row, { kind: 'tip', tip_to: tip.to, tip_amount: amount, tip_sig: tip.sig });
    }
    const { data, error } = await db.from('messages').insert(row).select().single();
    if (error) return reply(400, { error: error.message });
    return reply(200, data);
  } catch (e) {
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
