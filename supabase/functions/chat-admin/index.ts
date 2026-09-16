// Gali chat moderation. Every request is signed (signMessage) by the wallet that is the
// program's config authority, so moderation follows admin hand-overs automatically.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { configAuthority, cors, reply, verify } from '../_shared/solana.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const ACTIONS = ['hide', 'unhide', 'mute', 'unmute', 'list'] as const;
type Action = (typeof ACTIONS)[number];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const { admin, action, target = '', reason = '', ts, sig } = await req.json();
    if (!ACTIONS.includes(action)) return reply(400, { error: 'unknown action' });
    if (Math.abs(Date.now() - Number(ts)) > 120_000) return reply(400, { error: 'stale request; sign again' });
    const message = `gali-admin:${action}:${target}:${ts}`;
    if (!admin || !sig || !verify(String(sig), message, String(admin))) return reply(401, { error: 'bad signature' });
    if ((await configAuthority()) !== admin) return reply(403, { error: 'not the Gali admin wallet' });

    switch (action as Action) {
      case 'hide':
      case 'unhide': {
        const { error } = await db.from('messages').update({ hidden: action === 'hide' }).eq('id', Number(target));
        if (error) throw error;
        return reply(200, { ok: true });
      }
      case 'mute': {
        const { error } = await db.from('muted_wallets').upsert({ wallet: target, reason: String(reason).slice(0, 200), muted_by: admin });
        if (error) throw error;
        return reply(200, { ok: true });
      }
      case 'unmute': {
        const { error } = await db.from('muted_wallets').delete().eq('wallet', target);
        if (error) throw error;
        return reply(200, { ok: true });
      }
      case 'list': {
        const [muted, recent] = await Promise.all([
          db.from('muted_wallets').select('*').order('created_at', { ascending: false }),
          db.from('messages').select('*').order('id', { ascending: false }).limit(100),
        ]);
        if (muted.error) throw muted.error;
        if (recent.error) throw recent.error;
        return reply(200, { muted: muted.data, messages: recent.data });
      }
    }
  } catch (e) {
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
