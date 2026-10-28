// Gali direct messages. Deploy with the Supabase CLI (it bundles ../_shared): npx supabase functions deploy dm
//
// A player signs in once by signing a short text with their wallet (no transaction, no fee). This
// function checks the signature and hands back a pass that lasts 30 days (../_shared/pass.ts). Every other call carries the
// pass, and only ever reads or writes messages the pass's wallet sent or received. The tables are closed
// to the public key (sql/dm.sql), so nobody else can read a conversation.
//
// Sending tokens in a DM: the app sends them with the player's wallet first (the same tip the lobby
// uses), then posts the transaction here. It is shown as a tip only if the chain says that wallet really
// sent that amount to the other one.
//
// Calls (POST, JSON body with `a` for the action):
//   login  { wallet, ts, sig }            -> { pass, wallet, exp }
//   inbox  { pass }                       -> { threads: [{ wallet, name, last, at, unread, kind }] }
//   thread { pass, with }                 -> { msgs: [...], blocked }   (marks their messages read)
//   send   { pass, to, body, name }       -> { msg }
//   tip    { pass, to, token, amount, sig, name } -> { msg }
//   block  { pass, who, on }              -> { ok }
import { createClient } from 'npm:@supabase/supabase-js@2';
import { checkSignIn, isWallet, makePass, readPass } from '../_shared/pass.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const RPC = Deno.env.get('SOLANA_RPC') || 'https://api.mainnet-beta.solana.com';
const MINTS: Record<string, string> = {
  ORE: 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp',
  SKR: Deno.env.get('SKR_MINT') || 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
};
/** the same preset amounts the app offers */
const AMOUNTS: Record<string, number[]> = { SOL: [0.001, 0.005, 0.01], ORE: [0.01, 0.05, 0.1], SKR: [10, 50, 100] };

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const cleanName = (n: unknown) =>
  String(n ?? '')
    .replace(/[^A-Za-z0-9 _.-]/g, '')
    .trim()
    .slice(0, 14);
const cleanBody = (b: unknown) =>
  String(b ?? '')
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 280);

/* ---------------- chain check for tips ---------------- */
async function rpc(method: string, params: unknown[]) {
  const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
/** True when `sig` is a recent, successful transaction paid by `from` that moved `amount` of `token` to `to`. */
async function tipIsReal(sig: string, from: string, to: string, token: string, amount: number) {
  let tx = null;
  for (let k = 0; k < 5 && !tx; k++) {
    tx = await rpc('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null);
    if (!tx) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!tx || tx.meta?.err) return false;
  if (tx.blockTime && Date.now() / 1000 - tx.blockTime > 3600) return false;
  const keys: { pubkey: string; signer: boolean }[] = tx.transaction.message.accountKeys;
  if (keys[0]?.pubkey !== from || !keys[0]?.signer) return false;
  if (token === 'SOL') {
    const i = keys.findIndex((k) => k.pubkey === to);
    if (i < 0) return false;
    return tx.meta.postBalances[i] - tx.meta.preBalances[i] >= Math.round(amount * 1e9) - 1;
  }
  const mint = MINTS[token];
  type Bal = { owner: string; mint: string; uiTokenAmount: { uiAmount: number | null } };
  const bal = (list: Bal[]) => list.filter((x) => x.owner === to && x.mint === mint).reduce((s, x) => s + (x.uiTokenAmount.uiAmount ?? 0), 0);
  return bal(tx.meta.postTokenBalances ?? []) - bal(tx.meta.preTokenBalances ?? []) + 1e-9 >= amount;
}

/* ---------------- limits ---------------- */
async function tooFast(wallet: string, to: string) {
  const since = (ms: number) => new Date(Date.now() - ms).toISOString();
  const { count: minute } = await db.from('dms').select('id', { count: 'exact', head: true }).eq('sender', wallet).gt('at', since(60_000));
  if ((minute ?? 0) >= 30) return 'Slow down: 30 messages a minute at most';
  const { count: day } = await db.from('dms').select('id', { count: 'exact', head: true }).eq('sender', wallet).gt('at', since(86_400_000));
  if ((day ?? 0) >= 500) return 'That is 500 messages today: try again tomorrow';
  const { data: last } = await db.from('dms').select('at').eq('sender', wallet).order('id', { ascending: false }).limit(1);
  if (last?.[0] && Date.now() - new Date(last[0].at).getTime() < 800) return 'Slow down';
  // starting conversations: at most 15 new people a day, unless they have written to you before
  const { data: known } = await db.from('dms').select('id').eq('sender', to).eq('recipient', wallet).limit(1);
  const { data: sent } = await db.from('dms').select('id').eq('sender', wallet).eq('recipient', to).limit(1);
  if (!known?.length && !sent?.length) {
    const { data: today } = await db.from('dms').select('recipient').eq('sender', wallet).gt('at', since(86_400_000)).limit(2000);
    if (new Set((today ?? []).map((r) => r.recipient)).size >= 15) return 'You can start 15 new conversations a day';
  }
  return null;
}
async function isBlocked(by: string, who: string) {
  const { data } = await db.from('dm_blocks').select('wallet').eq('wallet', by).eq('blocked', who).maybeSingle();
  return Boolean(data);
}
/** Logs the real error and tells the caller only that something went wrong. */
function fail(e: unknown) {
  console.error('dm', (e as Error)?.message ?? e);
  return reply(500, { error: 'Something went wrong. Try again.' });
}
const COLS = 'id, at, sender, recipient, sender_name, kind, body, tip_token, tip_amount, tip_sig, read_at';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    if (Number(req.headers.get('content-length') ?? 0) > 4000) return reply(413, { error: 'too big' });
    const q = await req.json();
    const a = String(q?.a ?? '');

    if (a === 'login') {
      if (!checkSignIn(q.wallet, q.ts, q.sig)) return reply(401, { error: 'The sign-in did not check out: try again' });
      return reply(200, { wallet: q.wallet, ...(await makePass(q.wallet)) });
    }

    const me = await readPass(q.pass);
    if (!me) return reply(401, { error: 'Sign in again' });

    if (a === 'inbox') {
      const { data, error } = await db.from('dms').select(COLS).or(`sender.eq.${me},recipient.eq.${me}`).order('id', { ascending: false }).limit(400);
      if (error) return fail(error);
      const threads = new Map<string, { wallet: string; name: string; last: string; at: string; unread: number; kind: string; mine: boolean }>();
      for (const m of data ?? []) {
        const other = m.sender === me ? m.recipient : m.sender;
        let t = threads.get(other);
        if (!t) {
          t = { wallet: other, name: '', last: m.body, at: m.at, unread: 0, kind: m.kind, mine: m.sender === me };
          threads.set(other, t);
        }
        if (!t.name && m.sender === other && m.sender_name) t.name = m.sender_name;
        if (m.recipient === me && !m.read_at) t.unread += 1;
      }
      return reply(200, { threads: [...threads.values()].slice(0, 60) });
    }

    if (a === 'thread') {
      const other = q.with;
      if (!isWallet(other)) return reply(400, { error: 'bad wallet' });
      const { data, error } = await db
        .from('dms')
        .select(COLS)
        .or(`and(sender.eq.${me},recipient.eq.${other}),and(sender.eq.${other},recipient.eq.${me})`)
        .order('id', { ascending: false })
        .limit(120);
      if (error) return fail(error);
      if ((data ?? []).some((m) => m.recipient === me && !m.read_at)) {
        await db.from('dms').update({ read_at: new Date().toISOString() }).eq('recipient', me).eq('sender', other).is('read_at', null);
      }
      return reply(200, { msgs: (data ?? []).reverse(), blocked: await isBlocked(me, other) });
    }

    if (a === 'send' || a === 'tip') {
      const to = q.to;
      if (!isWallet(to) || to === me) return reply(400, { error: 'Pick another player' });
      if (await isBlocked(to, me)) return reply(403, { error: 'This player is not taking messages from you' });
      const name = cleanName(q.name);
      if (a === 'send') {
        const body = cleanBody(q.body);
        if (!body) return reply(400, { error: 'Write something first' });
        const slow = await tooFast(me, to);
        if (slow) return reply(429, { error: slow });
        const { data, error } = await db.from('dms').insert({ sender: me, recipient: to, sender_name: name, kind: 'msg', body }).select(COLS).single();
        if (error) return fail(error);
        return reply(200, { msg: data });
      }
      const token = String(q.token);
      const amount = Number(q.amount);
      const sig = String(q.sig ?? '');
      if (!AMOUNTS[token]?.includes(amount) || !/^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(sig)) return reply(400, { error: 'bad tip' });
      if (!(await tipIsReal(sig, me, to, token, amount))) return reply(400, { error: 'The chain does not show that transfer yet' });
      const { data, error } = await db
        .from('dms')
        .insert({ sender: me, recipient: to, sender_name: name, kind: 'tip', body: `Sent ${amount} ${token}`, tip_token: token, tip_amount: amount, tip_sig: sig })
        .select(COLS)
        .single();
      if (error) return /duplicate|unique/i.test(error.message) ? reply(400, { error: 'That transfer is already in the chat' }) : fail(error);
      return reply(200, { msg: data });
    }

    if (a === 'block') {
      const who = q.who;
      if (!isWallet(who) || who === me) return reply(400, { error: 'bad wallet' });
      if (q.on) await db.from('dm_blocks').upsert({ wallet: me, blocked: who });
      else await db.from('dm_blocks').delete().eq('wallet', me).eq('blocked', who);
      return reply(200, { ok: true });
    }

    return reply(400, { error: 'unknown action' });
  } catch (e) {
    return fail(e);
  }
});
