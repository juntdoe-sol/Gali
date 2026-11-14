// Gali team space for the admin page (galiadmin.bounded.page).
// A team wallet signs one login message; the reply is a 12-hour session that every other action carries.
// Team wallets are rows in team_members (role owner or member). Only the owner adds or removes members.
// Tasks, meetings, bug remarks (beta_bugs from gali.lol/beta) and the activity feed all go through here.
// Roles: owner (everything), admin (everything but team members), moderator (team work + chat), member (team work).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, reply, verify } from '../_shared/solana.ts';
import { FEE_LOW_LAMPORTS, FEE_WALLET, feeTransfer, SIG_RE } from '../_shared/feeTopup.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY);
const SESSION_MS = 12 * 3600_000;
const WALLET_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const TASK_STATUS = ['todo', 'doing', 'done'];
const PRIORITY = ['low', 'normal', 'high'];
const BUG_STATUS = ['new', 'confirmed', 'fixing', 'fixed', 'wontfix', 'duplicate', 'cantrepro'];
const ROLES = ['owner', 'admin', 'moderator', 'member'];
const ANN_KIND = ['info', 'event', 'warn', 'maintenance'];
const STAGES = ['idea', 'talking', 'proposal', 'deal', 'live', 'passed'];
const CHANNELS = ['x', 'tiktok', 'gali_tv', 'discord', 'other'];
const CONTENT_STATUS = ['idea', 'draft', 'ready', 'posted'];
const REVENUE_WALLET = 'HDa2MTDdZXnrjTs6RRUUzEqCcrWMWu1fM673Cg7pzQMw';
const ORE_PROGRAM = 'oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv';
/** Metaplex Core: a certificate mint (the nft function) carries the claim fee to the revenue wallet in the same transaction. */
const CORE_PROGRAM = 'CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d';
const ORE_MINT = 'oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp';
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3';
const RPC_URL = Deno.env.get('RPC_URL') || Deno.env.get('SOLANA_RPC') || '';
/** What each role may do beyond the shared team work (tasks, meetings, bugs, reviews, partners, content, health). */
const CAPS: Record<string, string[]> = {
  owner: ['members', 'release', 'announce', 'moderate', 'waitlist', 'revenue', 'money'],
  admin: ['release', 'announce', 'moderate', 'waitlist', 'revenue'],
  moderator: ['moderate', 'announce'],
  member: [],
};
const can = (role: string, cap: string) => (CAPS[role] ?? []).includes(cap);

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
let keyP: Promise<CryptoKey> | null = null;
const sessionKey = () =>
  (keyP ??= crypto.subtle
    .digest('SHA-256', enc.encode(`gali-team-session:${SERVICE_KEY}`))
    .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])));
const tagOf = async (wallet: string, exp: number) => hex(await crypto.subtle.sign('HMAC', await sessionKey(), enc.encode(`${wallet}.${exp}`)));

type Member = { wallet: string; name: string | null; role: string };
async function member(wallet: string): Promise<Member | null> {
  const { data, error } = await db.from('team_members').select('wallet,name,role').eq('wallet', wallet).maybeSingle();
  if (error) throw error;
  return data as Member | null;
}
async function sessionMember(session: unknown) {
  const [wallet, exp, tag] = String(session ?? '').split('.');
  if (!wallet || !exp || !tag || Number(exp) < Date.now()) return null;
  if ((await tagOf(wallet, Number(exp))) !== tag) return null;
  return member(wallet);
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const dateOrNull = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v ?? '')) ? String(v) : null);
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;
const urlOrNull = (v: unknown, re = /^https?:\/\//) => { const u = clean(v, 300); return u && re.test(u) ? u : null; };
const isoOrNull = (v: unknown) => { if (!v) return null; const d = new Date(String(v)); return Number.isNaN(d.getTime()) ? null : d.toISOString(); };

/* ---------- revenue wallet history from chain ---------- */
async function rpcCall(method: string, params: unknown[]) {
  const r = await fetch(RPC_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}
type Parsed = { sig: string; at: string; slot: number; sol: number; ore: number; skr: number; source: string; failed: boolean };
function parseTx(sig: string, tx: any): Parsed | null {
  if (!tx) return null;
  const keys: string[] = tx.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
  const i = keys.indexOf(REVENUE_WALLET);
  const sol = i >= 0 ? ((tx.meta.postBalances[i] ?? 0) - (tx.meta.preBalances[i] ?? 0)) / 1e9 : 0;
  const tok = (mint: string) => {
    const sum = (list: any[]) => (list ?? []).filter((b) => b.owner === REVENUE_WALLET && b.mint === mint).reduce((a, b) => a + Number(b.uiTokenAmount?.uiAmount ?? 0), 0);
    return sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  };
  const ore = tok(ORE_MINT), skr = tok(SKR_MINT);
  const progs = new Set<string>();
  for (const ix of tx.transaction.message.instructions ?? []) progs.add(ix.programId);
  for (const inner of tx.meta.innerInstructions ?? []) for (const ix of inner.instructions ?? []) progs.add(ix.programId);
  const source = progs.has(ORE_PROGRAM) && sol > 0 ? 'mining' : progs.has(CORE_PROGRAM) && sol > 0 ? 'nft' : (ore > 0 || skr > 0) ? 'arcade' : sol !== 0 ? 'transfer' : 'other';
  return { sig, at: new Date((tx.blockTime ?? 0) * 1000).toISOString(), slot: tx.slot, sol, ore, skr, source, failed: Boolean(tx.meta.err) };
}
/** Read new revenue-wallet transactions since the last one saved, at most 60 a call (the page calls again next time). */
async function syncRevenue() {
  if (!RPC_URL) return { added: 0, more: false, error: 'No RPC URL is set for the team function.' };
  const { data: last } = await db.from('team_revenue').select('sig').order('slot', { ascending: false }).limit(1);
  const until = last?.[0]?.sig;
  const sigs: any[] = await rpcCall('getSignaturesForAddress', [REVENUE_WALLET, { limit: 1000, commitment: 'confirmed', ...(until ? { until } : {}) }]);
  const todo = sigs.reverse().slice(0, 60); // oldest first, so a partial sync never leaves a gap
  const rows: Parsed[] = [];
  for (let k = 0; k < todo.length; k += 10) {
    const batch = await Promise.all(todo.slice(k, k + 10).map(async (s) => {
      try { return parseTx(s.signature, await rpcCall('getTransaction', [s.signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }])); }
      catch { return null; }
    }));
    for (const r of batch) if (r) rows.push(r);
  }
  if (rows.length) { const { error } = await db.from('team_revenue').upsert(rows); if (error) throw error; }
  return { added: rows.length, more: sigs.length > todo.length };
}
/* ---------- team chat, votes, money helpers ---------- */
const TOKENS = ['SOL', 'ORE', 'SKR'];
const DECIMALS: Record<string, number> = { SOL: 9, ORE: 11, SKR: 6 };
const TOKEN_MINT: Record<string, string> = { ORE: ORE_MINT, SKR: SKR_MINT };
const round = (n: number, d: number) => Math.floor(n * 10 ** d) / 10 ** d; // always round a cut down, never up

/** Unread counts per thread: 'team' plus one key per member wallet that DMed me. */
async function unreadFor(wallet: string) {
  const { data: reads } = await db.from('team_chat_reads').select('thread,last_id').eq('wallet', wallet);
  const last: Record<string, number> = Object.fromEntries((reads ?? []).map((r) => [r.thread, Number(r.last_id)]));
  const { data, error } = await db.from('team_chat').select('id,sender,recipient')
    .or(`recipient.is.null,recipient.eq.${wallet}`).neq('sender', wallet).order('id', { ascending: false }).limit(2000);
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const m of data ?? []) {
    const thread = m.recipient ? m.sender : 'team';
    if (m.id > (last[thread] ?? 0)) out[thread] = (out[thread] ?? 0) + 1;
  }
  return out;
}

/** Small things the header and badges need on every board load. */
async function boardExtra(wallet: string) {
  const [apk, votes, ballots, wd] = await Promise.all([
    db.from('team_settings').select('value').eq('key', 'apk_url').maybeSingle(),
    db.from('team_votes').select('id,closes_at').is('closed_at', null),
    db.from('team_vote_ballots').select('vote_id').eq('wallet', wallet),
    db.from('team_withdrawals').select('id,status,wallet').in('status', ['requested', 'approved']),
  ]);
  const voted = new Set((ballots.data ?? []).map((b) => b.vote_id));
  const open = (votes.data ?? []).filter((v) => !v.closes_at || new Date(v.closes_at).getTime() > Date.now());
  return {
    settings: { apk_url: (apk.data?.value as string) || null },
    votesToCast: open.filter((v) => !voted.has(v.id)).length,
    withdrawOpen: (wd.data ?? []).length,
  };
}

async function currentSplit() {
  const { data, error } = await db.from('team_split').select('*').order('effective_at', { ascending: false }).order('id', { ascending: false }).limit(20);
  if (error) throw error;
  return data ?? [];
}

/** Live balances of the revenue wallet, so the team can see what is actually there to pay from. */
async function revenueBalances() {
  if (!RPC_URL) return null;
  try {
    const [sol, toks] = await Promise.all([
      rpcCall('getBalance', [REVENUE_WALLET, { commitment: 'confirmed' }]),
      rpcCall('getTokenAccountsByOwner', [REVENUE_WALLET, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    ]);
    const out: Record<string, number> = { SOL: Number(sol.value ?? 0) / 1e9, ORE: 0, SKR: 0 };
    for (const a of toks.value ?? []) {
      const info = a.account?.data?.parsed?.info;
      for (const t of ['ORE', 'SKR']) if (info?.mint === TOKEN_MINT[t]) out[t] += Number(info.tokenAmount?.uiAmount ?? 0);
    }
    return out;
  } catch { return null; }
}

/** Did this transaction land, and did the payee get the token? Best effort: a missing RPC only skips the check. */
async function checkPayout(sig: string, to: string, token: string, amount: number) {
  if (!RPC_URL) return null;
  const tx = await rpcCall('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null);
  if (!tx) return 'That transaction was not found yet. Wait a few seconds after it confirms and try again.';
  if (tx.meta?.err) return 'That transaction failed on chain.';
  let got = 0;
  if (token === 'SOL') {
    const keys: string[] = tx.transaction.message.accountKeys.map((k: any) => (typeof k === 'string' ? k : k.pubkey));
    const i = keys.indexOf(to);
    got = i >= 0 ? ((tx.meta.postBalances[i] ?? 0) - (tx.meta.preBalances[i] ?? 0)) / 1e9 : 0;
  } else {
    const sum = (list: any[]) => (list ?? []).filter((b) => b.owner === to && b.mint === TOKEN_MINT[token]).reduce((a, b) => a + Number(b.uiTokenAmount?.uiAmount ?? 0), 0);
    got = sum(tx.meta.postTokenBalances) - sum(tx.meta.preTokenBalances);
  }
  if (got + 10 ** -DECIMALS[token] < amount * 0.999) return `That transaction sent ${round(Math.max(got, 0), 6)} ${token} to ${short(to)}, not ${amount}.`;
  return null;
}

/** The hall TV's key: its SHA-256 must match team_settings 'tv_agenda_key' {sha256}. Used by tv-agenda and tv-report. */
async function tvKeyOk(raw: unknown) {
  const key = String(raw ?? '');
  if (key.length < 32) return false;
  const { data: setting } = await db.from('team_settings').select('value').eq('key', 'tv_agenda_key').maybeSingle();
  const want = (setting?.value as { sha256?: string } | null)?.sha256;
  return !!want && hex(await crypto.subtle.digest('SHA-256', enc.encode(key))) === want;
}

async function log(actor: string, kind: string, text: string, ref: string | null = null) {
  await db.from('team_activity').insert({ actor, kind, text: text.slice(0, 300), ref });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const body = await req.json();
    const action = String(body.action ?? '');

    if (action === 'login') {
      const wallet = String(body.wallet ?? '');
      const ts = Number(body.ts);
      if (Math.abs(Date.now() - ts) > 120_000) return reply(400, { error: 'That signature is too old. Sign again.' });
      if (!WALLET_RE.test(wallet) || !body.sig || !verify(String(body.sig), `gali-team:login:${ts}`, wallet)) return reply(401, { error: 'The signature did not match this wallet.' });
      const m = await member(wallet);
      if (!m) return reply(403, { error: 'This wallet is not on the Gali team. Ask the owner to add it.' });
      const exp = Date.now() + SESSION_MS;
      await db.from('team_members').update({ last_seen: new Date().toISOString() }).eq('wallet', wallet);
      return reply(200, { session: `${wallet}.${exp}.${await tagOf(wallet, exp)}`, expires: exp, me: { ...m, caps: CAPS[m.role] ?? [] } });
    }

    // The hall TV's reminders (cleanyourtv dewan, AgendaWatch): read-only, no wallet. It carries a random key
    // whose SHA-256 is team_settings 'tv_agenda_key' {sha256}; it gets the owner's open tasks (and unassigned
    // ones) and meetings from 2 hours ago to 36 hours ahead.
    if (action === 'tv-agenda') {
      if (!(await tvKeyOk(body.tv_key))) return reply(401, { error: 'Not a known TV.' });
      const now = Date.now();
      const { data: ownerRow } = await db.from('team_members').select('wallet').eq('role', 'owner').limit(1).maybeSingle();
      const [meetings, tasks] = await Promise.all([
        db.from('team_meetings').select('id,title,starts_at,minutes,meet_url')
          .gte('starts_at', new Date(now - 2 * 3600_000).toISOString())
          .lte('starts_at', new Date(now + 36 * 3600_000).toISOString()).order('starts_at').limit(50),
        db.from('team_tasks').select('id,title,priority,due_on,assignee,created_at').neq('status', 'done')
          .or(ownerRow ? `assignee.eq.${ownerRow.wallet},assignee.is.null` : 'assignee.is.null')
          .order('due_on', { ascending: true, nullsFirst: false }).limit(100),
      ]);
      if (meetings.error) throw meetings.error;
      if (tasks.error) throw tasks.error;
      return reply(200, { now: new Date(now).toISOString(), meetings: meetings.data, tasks: tasks.data });
    }

    // The daily bug check's counts for the hall TV, same key as tv-agenda. tv_reports gets one row a day
    // (written with the service role only); this returns the newest one, or null before the first run.
    if (action === 'tv-report') {
      if (!(await tvKeyOk(body.tv_key))) return reply(401, { error: 'Not a known TV.' });
      const { data, error } = await db.from('tv_reports')
        .select('id,title,broken,critical,high,medium,low,fixed,todo,created_at')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return reply(200, { now: new Date().toISOString(), report: data });
    }

    const me = await sessionMember(body.session);
    if (!me) return reply(401, { error: 'Sign in again.' });
    const owner = me.role === 'owner';
    const caps = CAPS[me.role] ?? [];
    const meOut = { ...me, caps };
    const need = (cap: string) => (can(me.role, cap) ? null : reply(403, { error: 'Your role cannot do that. Ask the owner.' }));
    const who = me.name || short(me.wallet);

    switch (action) {
      case 'me':
        return reply(200, { me: meOut });

      case 'set-name': {
        const name = clean(body.name, 40);
        if (name.length < 2) return reply(400, { error: 'Use at least 2 characters.' });
        const { data, error } = await db.from('team_members').update({ name }).eq('wallet', me.wallet).select('wallet,name,role').single();
        if (error) throw error;
        await log(me.wallet, 'member', me.name ? `${me.name} is now called ${name}` : `${name} joined the team space`);
        return reply(200, { me: { ...data, caps } });
      }

      // ---------- everything the page needs in one call ----------
      case 'board': {
        const since = new Date(Date.now() - 30 * 864e5).toISOString();
        const [members, tasks, meetings, bugs, builds, activity, reports, reviews, tvAdmins, allReviews, partners, content, anns] = await Promise.all([
          db.from('team_members').select('wallet,name,role,added_at,last_seen').order('added_at'),
          db.from('team_tasks').select('*').order('created_at', { ascending: false }).limit(500),
          db.from('team_meetings').select('*').gte('starts_at', new Date(Date.now() - 14 * 864e5).toISOString()).order('starts_at').limit(200),
          db.from('beta_bugs').select('*').order('id', { ascending: false }).limit(500),
          db.from('beta_builds').select('*').order('released_on', { ascending: false, nullsFirst: true }),
          db.from('team_activity').select('*').order('created_at', { ascending: false }).limit(150),
          db.from('beta_bugs').select('id,username,title,severity,created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(60),
          db.from('beta_reviews').select('id,username,stars,updated_at').gte('updated_at', since).order('updated_at', { ascending: false }).limit(60),
          db.from('gali_tv_admins').select('wallet'),
          db.from('beta_reviews').select('id,username,platform,build,stars,tags,loved,wish,team_reply,created_at,updated_at').order('updated_at', { ascending: false }).limit(300),
          db.from('team_partners').select('*').order('updated_at', { ascending: false }),
          db.from('team_content').select('*').order('post_at', { ascending: true, nullsFirst: false }).limit(300),
          db.from('game_announcements').select('*').order('created_at', { ascending: false }).limit(50),
        ]);
        for (const r of [members, tasks, meetings, bugs, builds, activity, reports, reviews, tvAdmins, allReviews, partners, content, anns]) if (r.error) throw r.error;
        // one feed: team actions plus what testers did on gali.lol/beta
        const feed = [
          ...activity.data!.map((a) => ({ at: a.created_at, actor: a.actor, kind: a.kind, text: a.text, ref: a.ref })),
          ...reports.data!.map((b) => ({ at: b.created_at, actor: null, kind: 'tester-bug', text: `${b.username} reported bug #${b.id} (${b.severity}): ${b.title}`, ref: `bug:${b.id}` })),
          ...reviews.data!.map((r) => ({ at: r.updated_at, actor: null, kind: 'tester-review', text: `${r.username} left a ${r.stars}-star review`, ref: `review:${r.id}` })),
        ].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 150);
        const tv = new Set(tvAdmins.data!.map((x) => x.wallet));
        const [unread, extra] = await Promise.all([unreadFor(me.wallet), boardExtra(me.wallet)]);
        return reply(200, {
          me: meOut, unread, ...extra,
          members: members.data!.map((m) => ({ ...m, tv: tv.has(m.wallet) })),
          tasks: tasks.data, meetings: meetings.data, bugs: bugs.data, builds: builds.data, feed,
          reviews: allReviews.data, partners: partners.data, content: content.data, announcements: anns.data,
        });
      }

      // ---------- members (owner only) ----------
      case 'member-add': {
        if (!owner) return reply(403, { error: 'Only the owner can add team members.' });
        const wallet = clean(body.wallet, 44);
        if (!WALLET_RE.test(wallet)) return reply(400, { error: 'That is not a Solana wallet address.' });
        const name = clean(body.name, 40) || null;
        const { error } = await db.from('team_members').insert({ wallet, name, role: 'member', added_by: me.wallet });
        if (error) return reply(400, { error: error.code === '23505' ? 'That wallet is already on the team.' : error.message });
        if (body.tv) await db.from('gali_tv_admins').upsert({ wallet });
        await log(me.wallet, 'member', `${who} added ${name || short(wallet)} to the team`, `member:${wallet}`);
        return reply(200, { ok: true });
      }
      case 'member-tv': {
        if (!owner) return reply(403, { error: 'Only the owner can change Gali TV access.' });
        const wallet = clean(body.wallet, 44);
        if (!WALLET_RE.test(wallet)) return reply(400, { error: 'Bad wallet.' });
        if (body.tv) await db.from('gali_tv_admins').upsert({ wallet });
        else await db.from('gali_tv_admins').delete().eq('wallet', wallet);
        return reply(200, { ok: true });
      }
      case 'member-remove': {
        if (!owner) return reply(403, { error: 'Only the owner can remove team members.' });
        const wallet = clean(body.wallet, 44);
        if (wallet === me.wallet) return reply(400, { error: 'You cannot remove yourself.' });
        const { data, error } = await db.from('team_members').delete().eq('wallet', wallet).neq('role', 'owner').select('name').maybeSingle();
        if (error) throw error;
        if (!data) return reply(404, { error: 'No such member.' });
        await db.from('gali_tv_admins').delete().eq('wallet', wallet);
        await log(me.wallet, 'member', `${who} removed ${data.name || short(wallet)} from the team`);
        return reply(200, { ok: true });
      }

      // ---------- tasks ----------
      case 'task-save': {
        const title = clean(body.title, 140);
        if (!title) return reply(400, { error: 'Give the task a title.' });
        const row: Record<string, unknown> = {
          title,
          notes: clean(body.notes, 2000),
          priority: PRIORITY.includes(body.priority) ? body.priority : 'normal',
          assignee: WALLET_RE.test(String(body.assignee ?? '')) ? body.assignee : null,
          due_on: dateOrNull(body.due_on),
          bug_id: Number.isInteger(Number(body.bug_id)) && Number(body.bug_id) > 0 ? Number(body.bug_id) : null,
          updated_at: new Date().toISOString(),
        };
        if (body.id) {
          const { data, error } = await db.from('team_tasks').update(row).eq('id', String(body.id)).select().single();
          if (error) throw error;
          await log(me.wallet, 'task', `${who} edited task "${title}"`, `task:${data.id}`);
          return reply(200, { task: data });
        }
        const { data, error } = await db.from('team_tasks').insert({ ...row, status: 'todo', created_by: me.wallet }).select().single();
        if (error) throw error;
        const to = row.assignee ? (await member(String(row.assignee)))?.name : null;
        await log(me.wallet, 'task', `${who} added task "${title}"${to ? ` for ${to}` : ''}`, `task:${data.id}`);
        return reply(200, { task: data });
      }
      case 'task-move': {
        const status = TASK_STATUS.includes(body.status) ? body.status : null;
        if (!status) return reply(400, { error: 'Bad status.' });
        const { data, error } = await db.from('team_tasks')
          .update({ status, updated_at: new Date().toISOString(), done_at: status === 'done' ? new Date().toISOString() : null })
          .eq('id', String(body.id)).select().single();
        if (error) throw error;
        const label = { todo: 'To do', doing: 'Doing', done: 'Done' }[status as 'todo'];
        await log(me.wallet, 'task', `${who} moved "${data.title}" to ${label}`, `task:${data.id}`);
        return reply(200, { task: data });
      }
      case 'task-delete': {
        const { data, error } = await db.from('team_tasks').delete().eq('id', String(body.id)).select('title').maybeSingle();
        if (error) throw error;
        if (data) await log(me.wallet, 'task', `${who} deleted task "${data.title}"`);
        return reply(200, { ok: true });
      }

      // ---------- meetings ----------
      case 'meeting-save': {
        const title = clean(body.title, 140);
        if (!title) return reply(400, { error: 'Give the meeting a title.' });
        const starts = new Date(String(body.starts_at));
        if (Number.isNaN(starts.getTime())) return reply(400, { error: 'Pick a date and time.' });
        const url = clean(body.meet_url, 200);
        if (url && !/^https:\/\/meet\.google\.com\/[a-z0-9-]+/i.test(url)) return reply(400, { error: 'The Meet link should look like https://meet.google.com/abc-defg-hij' });
        const row = {
          title, agenda: clean(body.agenda, 2000), starts_at: starts.toISOString(),
          minutes: Math.min(480, Math.max(5, Math.round(Number(body.minutes) || 30))), meet_url: url || null,
        };
        if (body.id) {
          const { data, error } = await db.from('team_meetings').update(row).eq('id', String(body.id)).select().single();
          if (error) throw error;
          await log(me.wallet, 'meeting', `${who} changed the meeting "${title}"`, `meeting:${data.id}`);
          return reply(200, { meeting: data });
        }
        const { data, error } = await db.from('team_meetings').insert({ ...row, created_by: me.wallet }).select().single();
        if (error) throw error;
        await log(me.wallet, 'meeting', `${who} scheduled "${title}"`, `meeting:${data.id}`);
        return reply(200, { meeting: data });
      }
      case 'meeting-delete': {
        const { data, error } = await db.from('team_meetings').delete().eq('id', String(body.id)).select('title').maybeSingle();
        if (error) throw error;
        if (data) await log(me.wallet, 'meeting', `${who} cancelled "${data.title}"`);
        return reply(200, { ok: true });
      }

      // ---------- bugs from gali.lol/beta ----------
      case 'bug-update': {
        const id = Number(body.id);
        if (!Number.isInteger(id)) return reply(400, { error: 'Bad bug id.' });
        const patch: Record<string, unknown> = {};
        if ('status' in body) { if (!BUG_STATUS.includes(body.status)) return reply(400, { error: 'Bad status.' }); patch.status = body.status; }
        if ('team_note' in body) patch.team_note = clean(body.team_note, 600) || null;
        if ('fixed_in' in body) patch.fixed_in = clean(body.fixed_in, 20) || null;
        const { data, error } = await db.from('beta_bugs').update(patch).eq('id', id).select('id,title,status,fixed_in').single();
        if (error) throw error;
        const label: Record<string, string> = { new: 'New', confirmed: 'Seen', fixing: 'Fixing', fixed: 'Fixed', wontfix: "Won't fix", duplicate: 'Dupe', cantrepro: "Can't repro" };
        await log(me.wallet, 'bug', `${who} marked bug #${data.id} "${data.title}" as ${label[data.status]}${data.fixed_in ? ` (fixed in ${data.fixed_in})` : ''}`, `bug:${data.id}`);
        return reply(200, { bug: data });
      }

      // ---------- roles (owner only) ----------
      case 'member-role': {
        if (!owner) return reply(403, { error: 'Only the owner can change roles.' });
        const wallet = clean(body.wallet, 44), role = String(body.role);
        if (!ROLES.includes(role) || role === 'owner') return reply(400, { error: 'Pick admin, moderator or member.' });
        if (wallet === me.wallet) return reply(400, { error: 'You cannot change your own role.' });
        const { data, error } = await db.from('team_members').update({ role }).eq('wallet', wallet).neq('role', 'owner').select('name').maybeSingle();
        if (error) throw error;
        if (!data) return reply(404, { error: 'No such member.' });
        await log(me.wallet, 'member', `${who} made ${data.name || short(wallet)} ${role === 'admin' ? 'an admin' : `a ${role}`}`);
        return reply(200, { ok: true });
      }

      // ---------- releases on gali.lol/beta ----------
      case 'build-save': {
        const no = need('release'); if (no) return no;
        const version = clean(body.version, 20);
        if (!/^\d+\.\d+\.\d+$/.test(version)) return reply(400, { error: 'Use a version like 1.7.1' });
        const notes = (Array.isArray(body.notes) ? body.notes : []).slice(0, 40)
          .map((n: any) => ({ tag: ['new', 'fix', 'change'].includes(n?.tag) ? n.tag : 'new', text: clean(n?.text, 200) })).filter((n: any) => n.text);
        const focus = (Array.isArray(body.focus) ? body.focus : []).slice(0, 15).map((f: unknown) => clean(f, 160)).filter(Boolean);
        const row: Record<string, unknown> = {
          version, headline: clean(body.headline, 120) || null, notes, focus,
          version_code: Number.isInteger(Number(body.version_code)) && Number(body.version_code) > 0 ? Number(body.version_code) : null,
          apk_url: urlOrNull(body.apk_url, /^https:\/\//), released_on: dateOrNull(body.released_on),
        };
        const { data: had } = await db.from('beta_builds').select('version,status').eq('version', version).maybeSingle();
        if (!had) row.status = 'draft'; // hidden from gali.lol/beta until someone puts it in testing
        const { data, error } = await db.from('beta_builds').upsert(row).select().single();
        if (error) throw error;
        await log(me.wallet, 'release', had ? `${who} edited the ${version} release notes` : `${who} started release ${version}`, `build:${version}`);
        return reply(200, { build: data });
      }
      case 'build-ship': {
        const no = need('release'); if (no) return no;
        const version = clean(body.version, 20);
        const { data: b } = await db.from('beta_builds').select('*').eq('version', version).maybeSingle();
        if (!b) return reply(404, { error: 'No such build.' });
        if (!b.apk_url) return reply(400, { error: 'Add the APK link before you ship it.' });
        await db.from('beta_builds').update({ status: 'old' }).eq('status', 'live');
        const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10); // Malaysia date
        const { error } = await db.from('beta_builds').update({ status: 'live', released_on: b.released_on || today }).eq('version', version);
        if (error) throw error;
        await log(me.wallet, 'release', `${who} shipped APK ${version} to testers`, `build:${version}`);
        return reply(200, { ok: true });
      }
      case 'build-status': {
        const no = need('release'); if (no) return no;
        const version = clean(body.version, 20), status = String(body.status);
        if (!['draft', 'next', 'old'].includes(status)) return reply(400, { error: 'Bad status.' });
        const { data: was } = await db.from('beta_builds').select('status').eq('version', version).maybeSingle();
        if (was?.status === 'live') return reply(400, { error: 'Ship another build to replace the live one.' });
        const { error } = await db.from('beta_builds').update({ status }).eq('version', version);
        if (error) throw error;
        if (status === 'next') await log(me.wallet, 'release', `${who} put ${version} in testing on gali.lol/beta`, `build:${version}`);
        return reply(200, { ok: true });
      }
      case 'build-delete': {
        const no = need('release'); if (no) return no;
        const version = clean(body.version, 20);
        const { data } = await db.from('beta_builds').select('status').eq('version', version).maybeSingle();
        if (data?.status === 'live') return reply(400, { error: 'Ship another build before you delete the live one.' });
        const { error } = await db.from('beta_builds').delete().eq('version', version);
        if (error) throw error;
        await log(me.wallet, 'release', `${who} deleted release ${version}`);
        return reply(200, { ok: true });
      }

      // ---------- tester reviews ----------
      case 'review-reply': {
        const id = Number(body.id);
        const text = clean(body.text, 600) || null;
        const { data, error } = await db.from('beta_reviews').update({ team_reply: text }).eq('id', id).select('username').single();
        if (error) throw error;
        await log(me.wallet, 'review', text ? `${who} replied to ${data.username}'s review` : `${who} removed the reply on ${data.username}'s review`, `review:${id}`);
        return reply(200, { ok: true });
      }

      // ---------- waitlist ----------
      case 'waitlist': {
        const no = need('waitlist'); if (no) return no;
        const { data, error } = await db.from('waitlist').select('id,email,x_handle,mined_before,protocols,referred_by,source,created_at').order('id', { ascending: false }).limit(5000);
        if (error) throw error;
        return reply(200, { rows: data });
      }

      // ---------- lobby chat moderation ----------
      case 'chat': {
        const no = need('moderate'); if (no) return no;
        const [lines, muted] = await Promise.all([
          db.from('lobby_chat').select('id,at,name,body,wallet,hidden').order('id', { ascending: false }).limit(250),
          db.from('lobby_chat_muted').select('wallet,at').order('at', { ascending: false }),
        ]);
        if (lines.error) throw lines.error;
        if (muted.error) throw muted.error;
        return reply(200, { lines: lines.data, muted: muted.data });
      }
      case 'chat-hide': {
        const no = need('moderate'); if (no) return no;
        const id = Number(body.id), hidden = Boolean(body.hidden);
        const { data, error } = await db.from('lobby_chat').update({ hidden }).eq('id', id).select('name,body').single();
        if (error) throw error;
        await log(me.wallet, 'moderation', `${who} ${hidden ? 'hid' : 'restored'} a chat line from ${data.name}`);
        return reply(200, { ok: true });
      }
      case 'chat-mute': {
        const no = need('moderate'); if (no) return no;
        const wallet = clean(body.wallet, 44);
        if (!WALLET_RE.test(wallet)) return reply(400, { error: 'Bad wallet.' });
        const name = (await db.from('gali_miners').select('name').eq('wallet', wallet).maybeSingle()).data?.name || short(wallet);
        if (body.mute) { const { error } = await db.from('lobby_chat_muted').upsert({ wallet }); if (error) throw error; }
        else { const { error } = await db.from('lobby_chat_muted').delete().eq('wallet', wallet); if (error) throw error; }
        await log(me.wallet, 'moderation', `${who} ${body.mute ? 'muted' : 'unmuted'} ${name} in lobby chat`);
        return reply(200, { ok: true });
      }

      // ---------- daily bug check (written by the scheduled check into tv_reports) ----------
      case 'bug-reports': { // every team member can see it
        const days = Math.min(Math.max(Number(body.days ?? 14) || 14, 1), 60);
        const { data, error } = await db.from('tv_reports')
          .select('id,title,broken,critical,high,medium,low,fixed,todo,details,created_at')
          .gte('created_at', new Date(Date.now() - days * 864e5).toISOString())
          .order('created_at', { ascending: false }).limit(100);
        if (error) throw error;
        return reply(200, { rows: data });
      }

      // ---------- game health ----------
      case 'health': {
        const { data, error } = await db.rpc('team_ops_health');
        if (error) throw error;
        return reply(200, { health: data, at: new Date().toISOString() });
      }

      // ---------- revenue over time ----------
      case 'revenue': { // every team member can see revenue
        let sync: Record<string, unknown> = {};
        try { sync = await syncRevenue(); } catch (e) { sync = { error: String((e as Error).message ?? e) }; }
        const { data, error } = await db.from('team_revenue').select('*').gte('at', new Date(Date.now() - 90 * 864e5).toISOString()).order('at', { ascending: false }).limit(5000);
        if (error) throw error;
        return reply(200, { rows: data, sync });
      }

      // ---------- autopilot fee wallet: the owner tops it up from the admin page with their own wallet ----------
      case 'fee-wallet': {
        const no = need('money'); if (no) return no;
        if (!RPC_URL) return reply(503, { error: 'RPC_URL is not set on the team function.' });
        const [fee, revenue, bh, rows] = await Promise.all([
          rpcCall('getBalance', [FEE_WALLET, { commitment: 'confirmed' }]).catch(() => null),
          rpcCall('getBalance', [REVENUE_WALLET, { commitment: 'confirmed' }]).catch(() => null),
          rpcCall('getLatestBlockhash', [{ commitment: 'confirmed' }]).catch(() => null),
          db.from('gali_fee_topups').select('*').order('at', { ascending: false }).limit(50),
        ]);
        if (rows.error) throw rows.error;
        return reply(200, {
          feeWallet: FEE_WALLET, revenueWallet: REVENUE_WALLET, min: FEE_LOW_LAMPORTS,
          fee: fee?.value ?? null, revenue: revenue?.value ?? null, blockhash: bh?.value?.blockhash ?? null, rows: rows.data,
        });
      }
      case 'fee-status': { // the Overview's "needs a top-up" check: one balance read
        const no = need('money'); if (no) return no;
        if (!RPC_URL) return reply(503, { error: 'RPC_URL is not set on the team function.' });
        const fee = (await rpcCall('getBalance', [FEE_WALLET, { commitment: 'confirmed' }]))?.value ?? null;
        return reply(200, { fee, min: FEE_LOW_LAMPORTS, low: fee !== null && fee < FEE_LOW_LAMPORTS });
      }
      case 'fee-topup': { // record a transfer to the fee wallet, after checking it on chain
        const no = need('money'); if (no) return no;
        const sig = String(body.signature ?? '').trim();
        if (!SIG_RE.test(sig)) return reply(400, { error: 'That is not a transaction signature.' });
        if (!RPC_URL) return reply(503, { error: 'RPC_URL is not set on the team function.' });
        // the page posts right after the wallet sends; give the RPC a few tries to see it
        let tx: any = null;
        for (let i = 0; i < 6 && !tx; i++) {
          if (i) await new Promise((r) => setTimeout(r, 2000));
          tx = await rpcCall('getTransaction', [sig, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 0 }]).catch(() => null);
        }
        const t = feeTransfer(tx);
        if (typeof t === 'string') return reply(tx ? 400 : 404, { error: t });
        const { data, error } = await db.from('gali_fee_topups').insert({
          at: t.at, from_wallet: t.from, to_wallet: FEE_WALLET, lamports: t.lamports, from_before: t.fromBefore,
          fee_before: t.feeBefore, fee_after: t.feeAfter, signature: sig, recorded_by: me.wallet,
        }).select('*').single();
        if (error?.code === '23505') return reply(409, { error: 'That top-up is already recorded.' });
        if (error) throw error;
        const sol = Math.round(t.lamports / 1e5) / 1e4;
        await log(me.wallet, 'money', `${me.name || short(me.wallet)} topped up the autopilot fee wallet with ${sol} SOL${t.from === REVENUE_WALLET ? ' from the revenue wallet' : ` from ${short(t.from)}`}`, sig);
        return reply(200, { row: data });
      }

      // ---------- in-game announcements ----------
      case 'announce-save': {
        const no = need('announce'); if (no) return no;
        const text = clean(body.text, 160);
        if (!text) return reply(400, { error: 'Write the announcement.' });
        const row = {
          kind: ANN_KIND.includes(body.kind) ? body.kind : 'info', text, link: urlOrNull(body.link, /^https:\/\//),
          starts_at: isoOrNull(body.starts_at) ?? new Date().toISOString(), ends_at: isoOrNull(body.ends_at), active: body.active !== false,
        };
        const q = body.id ? db.from('game_announcements').update(row).eq('id', Number(body.id)) : db.from('game_announcements').insert({ ...row, created_by: me.wallet });
        const { error } = await q;
        if (error) throw error;
        await log(me.wallet, 'announce', body.id ? `${who} edited the announcement "${text}"` : `${who} posted "${text}" in the game`);
        return reply(200, { ok: true });
      }
      case 'announce-delete': {
        const no = need('announce'); if (no) return no;
        const { data, error } = await db.from('game_announcements').delete().eq('id', Number(body.id)).select('text').maybeSingle();
        if (error) throw error;
        if (data) await log(me.wallet, 'announce', `${who} took down "${data.text}"`);
        return reply(200, { ok: true });
      }

      // ---------- partners ----------
      case 'partner-save': {
        const name = clean(body.name, 80);
        if (!name) return reply(400, { error: 'Give the partner a name.' });
        const row = {
          name, contact: clean(body.contact, 120), link: urlOrNull(body.link), stage: STAGES.includes(body.stage) ? body.stage : 'talking',
          owner: WALLET_RE.test(String(body.owner ?? '')) ? body.owner : null, next_step: clean(body.next_step, 200), next_on: dateOrNull(body.next_on),
          notes: clean(body.notes, 2000), updated_at: new Date().toISOString(),
        };
        if (body.id) {
          const { data: before } = await db.from('team_partners').select('stage').eq('id', String(body.id)).maybeSingle();
          const { error } = await db.from('team_partners').update(row).eq('id', String(body.id));
          if (error) throw error;
          await log(me.wallet, 'partner', before && before.stage !== row.stage ? `${who} moved ${name} to ${row.stage}` : `${who} updated ${name}`);
        } else {
          const { error } = await db.from('team_partners').insert({ ...row, created_by: me.wallet });
          if (error) throw error;
          await log(me.wallet, 'partner', `${who} added partner ${name}`);
        }
        return reply(200, { ok: true });
      }
      case 'partner-delete': {
        const { data, error } = await db.from('team_partners').delete().eq('id', String(body.id)).select('name').maybeSingle();
        if (error) throw error;
        if (data) await log(me.wallet, 'partner', `${who} removed partner ${data.name}`);
        return reply(200, { ok: true });
      }

      // ---------- content calendar ----------
      case 'content-save': {
        const title = clean(body.title, 140);
        if (!title) return reply(400, { error: 'Give the post a title.' });
        const row = {
          title, channel: CHANNELS.includes(body.channel) ? body.channel : 'x', post_at: isoOrNull(body.post_at),
          status: CONTENT_STATUS.includes(body.status) ? body.status : 'idea', owner: WALLET_RE.test(String(body.owner ?? '')) ? body.owner : null,
          link: urlOrNull(body.link), notes: clean(body.notes, 2000), updated_at: new Date().toISOString(),
        };
        if (body.id) {
          const { error } = await db.from('team_content').update(row).eq('id', String(body.id));
          if (error) throw error;
          await log(me.wallet, 'content', row.status === 'posted' ? `${who} marked "${title}" as posted` : `${who} updated "${title}"`);
        } else {
          const { error } = await db.from('team_content').insert({ ...row, created_by: me.wallet });
          if (error) throw error;
          await log(me.wallet, 'content', `${who} planned "${title}"`);
        }
        return reply(200, { ok: true });
      }
      case 'content-delete': {
        const { data, error } = await db.from('team_content').delete().eq('id', String(body.id)).select('title').maybeSingle();
        if (error) throw error;
        if (data) await log(me.wallet, 'content', `${who} dropped "${data.title}"`);
        return reply(200, { ok: true });
      }

      // ---------- team chat: 'team' is the whole-team channel, a member wallet is a DM ----------
      case 'talk': {
        const thread = clean(body.thread, 44) || 'team';
        const dm = thread !== 'team';
        if (dm && (!WALLET_RE.test(thread) || !(await member(thread)))) return reply(400, { error: 'That person is not on the team.' });
        let q = db.from('team_chat').select('id,at,sender,recipient,body');
        q = dm ? q.or(`and(sender.eq.${me.wallet},recipient.eq.${thread}),and(sender.eq.${thread},recipient.eq.${me.wallet})`) : q.is('recipient', null);
        const after = Number(body.after) || 0, before = Number(body.before) || 0;
        if (after) q = q.gt('id', after);
        if (before) q = q.lt('id', before);
        const { data, error } = await q.order('id', { ascending: false }).limit(after ? 200 : 60);
        if (error) throw error;
        const msgs = (data ?? []).reverse();
        const top = msgs.length ? msgs[msgs.length - 1].id : 0;
        if (top && !before) {
          const { data: r } = await db.from('team_chat_reads').select('last_id').eq('wallet', me.wallet).eq('thread', thread).maybeSingle();
          if (!r || Number(r.last_id) < top) await db.from('team_chat_reads').upsert({ wallet: me.wallet, thread, last_id: top });
        }
        // when the other person last read this DM, for a "seen" mark
        let seen = 0;
        if (dm) seen = Number((await db.from('team_chat_reads').select('last_id').eq('wallet', thread).eq('thread', me.wallet).maybeSingle()).data?.last_id ?? 0);
        return reply(200, { messages: msgs, more: !after && (data ?? []).length === 60, unread: await unreadFor(me.wallet), seen });
      }
      case 'talk-send': {
        const thread = clean(body.thread, 44) || 'team';
        const text = String(body.body ?? '').trim().slice(0, 2000);
        if (!text) return reply(400, { error: 'Write something first.' });
        let recipient: string | null = null;
        if (thread !== 'team') {
          if (thread === me.wallet) return reply(400, { error: 'Pick someone else to message.' });
          if (!WALLET_RE.test(thread) || !(await member(thread))) return reply(400, { error: 'That person is not on the team.' });
          recipient = thread;
        }
        const { data, error } = await db.from('team_chat').insert({ sender: me.wallet, recipient, body: text }).select('id,at,sender,recipient,body').single();
        if (error) throw error;
        await db.from('team_chat_reads').upsert({ wallet: me.wallet, thread, last_id: data.id });
        return reply(200, { message: data });
      }
      case 'talk-delete': {
        const { data, error } = await db.from('team_chat').delete().eq('id', Number(body.id)).eq('sender', me.wallet).select('id').maybeSingle();
        if (error) throw error;
        if (!data) return reply(404, { error: 'You can only delete your own messages.' });
        return reply(200, { ok: true });
      }

      // ---------- decision votes ----------
      case 'votes': {
        const [votes, ballots] = await Promise.all([
          db.from('team_votes').select('*').order('created_at', { ascending: false }).limit(100),
          db.from('team_vote_ballots').select('vote_id,wallet,choice,at'),
        ]);
        if (votes.error) throw votes.error;
        if (ballots.error) throw ballots.error;
        const by: Record<number, unknown[]> = {};
        for (const b of ballots.data ?? []) (by[b.vote_id] ??= []).push(b);
        return reply(200, { votes: (votes.data ?? []).map((v) => ({ ...v, ballots: by[v.id] ?? [] })) });
      }
      case 'vote-create': {
        const title = clean(body.title, 160);
        if (title.length < 3) return reply(400, { error: 'Write the question.' });
        const options = (Array.isArray(body.options) ? body.options : []).map((o: unknown) => clean(o, 80)).filter(Boolean).slice(0, 6);
        if (options.length < 2) return reply(400, { error: 'Give at least two choices.' });
        if (new Set(options.map((o: string) => o.toLowerCase())).size !== options.length) return reply(400, { error: 'Two choices are the same.' });
        const closes = isoOrNull(body.closes_at);
        if (closes && new Date(closes).getTime() < Date.now() + 5 * 60000) return reply(400, { error: 'Pick a closing time at least a few minutes from now.' });
        const { data, error } = await db.from('team_votes').insert({ title, details: clean(body.details, 2000) || null, options, closes_at: closes, created_by: me.wallet }).select('id').single();
        if (error) throw error;
        await log(me.wallet, 'vote', `${who} started a vote: "${title}"`, `vote:${data.id}`);
        return reply(200, { id: data.id });
      }
      case 'vote-cast': {
        const id = Number(body.id), choice = Number(body.choice);
        const { data: v } = await db.from('team_votes').select('*').eq('id', id).maybeSingle();
        if (!v) return reply(404, { error: 'No such vote.' });
        if (v.closed_at || (v.closes_at && new Date(v.closes_at).getTime() <= Date.now())) return reply(400, { error: 'This vote is closed.' });
        if (!Number.isInteger(choice) || choice < 0 || choice >= v.options.length) return reply(400, { error: 'Pick one of the choices.' });
        const { data: had } = await db.from('team_vote_ballots').select('choice').eq('vote_id', id).eq('wallet', me.wallet).maybeSingle();
        const { error } = await db.from('team_vote_ballots').upsert({ vote_id: id, wallet: me.wallet, choice, at: new Date().toISOString() });
        if (error) throw error;
        if (!had) await log(me.wallet, 'vote', `${who} voted on "${v.title}"`, `vote:${id}`);
        return reply(200, { ok: true });
      }
      case 'vote-close': {
        const id = Number(body.id);
        const { data: v } = await db.from('team_votes').select('*').eq('id', id).maybeSingle();
        if (!v) return reply(404, { error: 'No such vote.' });
        if (v.created_by !== me.wallet && !owner) return reply(403, { error: 'Only whoever started the vote, or the owner, can close it.' });
        if (v.closed_at) return reply(400, { error: 'Already closed.' });
        const { data: bs } = await db.from('team_vote_ballots').select('choice').eq('vote_id', id);
        const n = v.options.map((_: string, i: number) => (bs ?? []).filter((b) => b.choice === i).length);
        const top = Math.max(0, ...n);
        const winners = v.options.filter((_: string, i: number) => n[i] === top && top > 0);
        const outcome = clean(body.outcome, 200) || (winners.length === 1 ? winners[0] : winners.length ? `Tie: ${winners.join(' / ')}` : 'No votes');
        const { error } = await db.from('team_votes').update({ closed_at: new Date().toISOString(), outcome }).eq('id', id);
        if (error) throw error;
        await log(me.wallet, 'vote', `${who} closed "${v.title}": ${outcome}`, `vote:${id}`);
        return reply(200, { ok: true, outcome });
      }
      case 'vote-delete': {
        const id = Number(body.id);
        const { data: v } = await db.from('team_votes').select('created_by,title').eq('id', id).maybeSingle();
        if (!v) return reply(404, { error: 'No such vote.' });
        if (v.created_by !== me.wallet && !owner) return reply(403, { error: 'Only whoever started the vote, or the owner, can delete it.' });
        const { error } = await db.from('team_votes').delete().eq('id', id);
        if (error) throw error;
        await log(me.wallet, 'vote', `${who} deleted the vote "${v.title}"`);
        return reply(200, { ok: true });
      }

      // ---------- money: split, everyone's cut, withdrawals ----------
      case 'money': {
        let sync: Record<string, unknown> = {};
        if (body.sync !== false) { try { sync = await syncRevenue(); } catch (e) { sync = { error: String((e as Error).message ?? e) }; } }
        const [earn, split, wd, members, fees, balances] = await Promise.all([
          db.rpc('team_earnings'),
          currentSplit(),
          db.from('team_withdrawals').select('*').order('created_at', { ascending: false }).limit(500),
          db.from('team_members').select('wallet,name,role'),
          db.from('team_revenue').select('source,sol,ore,skr,at').eq('failed', false).in('source', ['mining', 'arcade', 'nft']),
          revenueBalances(),
        ]);
        if (earn.error) throw earn.error;
        if (wd.error) throw wd.error;
        if (fees.error) throw fees.error;
        // totals by source and token, all time and last 30 days
        const totals: Record<string, Record<string, number>> = {};
        const d30 = Date.now() - 30 * 864e5;
        for (const r of fees.data ?? []) {
          const add = (k: string, t: string, v: number) => { if (v > 0) { totals[k] ??= {}; totals[k][t] = (totals[k][t] ?? 0) + v; } };
          for (const t of TOKENS) {
            const v = Number((r as any)[t.toLowerCase()]) || 0;
            if (t !== 'SOL' && r.source !== 'arcade') continue;
            add('all', t, v); add(r.source, t, v);
            if (new Date(r.at).getTime() > d30) add('d30', t, v);
          }
        }
        // per wallet: earned, paid, pending, available
        const people: Record<string, any> = {};
        const row = (w: string) => (people[w] ??= { wallet: w, earned: {}, paid: {}, pending: {}, available: {} });
        for (const e of earn.data ?? []) row(e.wallet).earned[e.token] = Number(e.earned);
        for (const w of wd.data ?? []) {
          if (w.status === 'paid') row(w.wallet).paid[w.token] = (row(w.wallet).paid[w.token] ?? 0) + Number(w.amount);
          if (w.status === 'requested' || w.status === 'approved') row(w.wallet).pending[w.token] = (row(w.wallet).pending[w.token] ?? 0) + Number(w.amount);
        }
        for (const w of Object.keys(split[0]?.shares ?? {})) row(w);
        for (const p of Object.values(people)) for (const t of TOKENS) p.available[t] = Math.max(0, round((p.earned[t] ?? 0) - (p.paid[t] ?? 0) - (p.pending[t] ?? 0), DECIMALS[t]));
        return reply(200, { sync, split, people: Object.values(people), withdrawals: wd.data, totals, balances, members: members.data, revenueWallet: REVENUE_WALLET });
      }
      case 'split-set': {
        if (!owner) return reply(403, { error: 'Only the owner can change the split.' });
        const pct = Number(body.platform_pct);
        if (!(pct >= 0 && pct <= 100)) return reply(400, { error: 'The Gali share must be 0 to 100%.' });
        const shares: Record<string, number> = {};
        for (const [w, v] of Object.entries(body.shares ?? {})) {
          const n = Math.round(Number(v) * 100) / 100;
          if (!WALLET_RE.test(w) || !(n >= 0)) return reply(400, { error: 'Bad share.' });
          if (n > 0) { if (!(await member(w))) return reply(400, { error: `${short(w)} is not on the team.` }); shares[w] = n; }
        }
        const sum = Object.values(shares).reduce((a, b) => a + b, 0);
        if (Object.keys(shares).length && Math.abs(sum - 100) > 0.01) return reply(400, { error: `The team shares add up to ${sum}%. Make them 100%.` });
        if (!Object.keys(shares).length && pct < 100) return reply(400, { error: 'Give the team pool to at least one person.' });
        const { error } = await db.from('team_split').insert({ platform_bps: Math.round(pct * 100), shares, set_by: me.wallet, note: clean(body.note, 200) || null });
        if (error) throw error;
        await log(me.wallet, 'money', `${who} changed the revenue split to ${pct}% Gali / ${100 - pct}% team, from now on`);
        return reply(200, { ok: true });
      }
      case 'withdraw-request': {
        const token = String(body.token ?? '').toUpperCase();
        if (!TOKENS.includes(token)) return reply(400, { error: 'Pick SOL, ORE or SKR.' });
        const amount = round(Number(body.amount), DECIMALS[token]);
        if (!(amount > 0)) return reply(400, { error: 'Enter an amount above zero.' });
        const to = clean(body.to_wallet, 44) || me.wallet;
        if (!WALLET_RE.test(to)) return reply(400, { error: 'That is not a Solana wallet address.' });
        const report = String(body.report ?? '').trim().slice(0, 4000);
        if (report.length < 40) return reply(400, { error: 'Add your latest weekly report as a co-founder (what you shipped, what is next) before asking to withdraw.' });
        const { data, error } = await db.rpc('team_withdraw_request', { p_wallet: me.wallet, p_token: token, p_amount: amount, p_to: to, p_note: clean(body.note, 300) || null, p_report: report });
        if (error) return reply(400, { error: error.message });
        await log(me.wallet, 'money', `${who} asked to withdraw ${amount} ${token}`, `withdraw:${(data as any).id}`);
        return reply(200, { withdrawal: data });
      }
      case 'withdraw-cancel': {
        const { data, error } = await db.from('team_withdrawals').update({ status: 'cancelled', decided_at: new Date().toISOString(), decided_by: me.wallet })
          .eq('id', Number(body.id)).eq('wallet', me.wallet).eq('status', 'requested').select('amount,token').maybeSingle();
        if (error) throw error;
        if (!data) return reply(400, { error: 'Only a request still waiting can be cancelled.' });
        await log(me.wallet, 'money', `${who} cancelled a withdrawal of ${data.amount} ${data.token}`);
        return reply(200, { ok: true });
      }
      case 'withdraw-decide': {
        if (!owner) return reply(403, { error: 'Only the owner approves withdrawals.' });
        const decision = String(body.decision);
        if (!['approved', 'rejected'].includes(decision)) return reply(400, { error: 'Approve or reject.' });
        const { data, error } = await db.from('team_withdrawals').update({ status: decision, decided_at: new Date().toISOString(), decided_by: me.wallet, decision_note: clean(body.note, 300) || null })
          .eq('id', Number(body.id)).eq('status', 'requested').select('wallet,amount,token').maybeSingle();
        if (error) throw error;
        if (!data) return reply(400, { error: 'That request was already handled.' });
        const m = await member(data.wallet);
        await log(me.wallet, 'money', `${who} ${decision} ${m?.name || short(data.wallet)}'s withdrawal of ${data.amount} ${data.token}`);
        return reply(200, { ok: true });
      }
      case 'withdraw-paid': {
        if (!owner) return reply(403, { error: 'Only the owner marks withdrawals paid.' });
        const sig = clean(body.tx_sig, 100);
        if (!/^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig)) return reply(400, { error: 'Paste the transaction signature from your wallet or Solscan.' });
        const { data: w } = await db.from('team_withdrawals').select('*').eq('id', Number(body.id)).maybeSingle();
        if (!w) return reply(404, { error: 'No such request.' });
        if (!['requested', 'approved'].includes(w.status)) return reply(400, { error: `This request is ${w.status}.` });
        const used = await db.from('team_withdrawals').select('id').eq('tx_sig', sig).neq('id', w.id).limit(1);
        if (used.data?.length) return reply(400, { error: 'That transaction is already used for another payout.' });
        const problem = await checkPayout(sig, w.to_wallet, w.token, Number(w.amount));
        if (problem && !body.force) return reply(400, { error: problem, canForce: true });
        const now = new Date().toISOString();
        const { error } = await db.from('team_withdrawals').update({ status: 'paid', paid_at: now, tx_sig: sig, decided_at: w.decided_at ?? now, decided_by: w.decided_by ?? me.wallet }).eq('id', w.id);
        if (error) throw error;
        const m = await member(w.wallet);
        await log(me.wallet, 'money', `${who} paid ${m?.name || short(w.wallet)} ${w.amount} ${w.token}`, `withdraw:${w.id}`);
        return reply(200, { ok: true });
      }

      // ---------- settings: the admin app APK link ----------
      case 'settings-set': {
        const no = need('release'); if (no) return no;
        const url = clean(body.apk_url, 300);
        if (url && !/^https:\/\//.test(url)) return reply(400, { error: 'Use an https:// link (the Expo build page or the .apk file).' });
        const { error } = await db.from('team_settings').upsert({ key: 'apk_url', value: url || null, updated_at: new Date().toISOString(), updated_by: me.wallet });
        if (error) throw error;
        await log(me.wallet, 'release', url ? `${who} updated the admin app download` : `${who} removed the admin app download`);
        return reply(200, { ok: true });
      }

      // ---------- players / miners ----------
      case 'players': {
        const [miners, days, founding, certs, kos, wins, chat, muted, bugs, reviews] = await Promise.all([
          db.from('gali_miners').select('*').order('points', { ascending: false }).limit(5000),
          db.from('gali_miner_days').select('wallet,day,ore_close,pts_close,pts_open').gte('day', new Date(Date.now() - 8 * 864e5).toISOString().slice(0, 10)).order('day', { ascending: false }).limit(20000),
          db.from('founding_miners').select('wallet,rounds,done'),
          db.from('cert_claims').select('wallet,serial,status'),
          db.from('brawl_kos').select('killer,victim').limit(50000),
          db.from('brawl_wins').select('winner').limit(50000),
          db.from('lobby_chat').select('wallet').limit(50000),
          db.from('lobby_chat_muted').select('wallet'),
          db.from('beta_bugs').select('wallet').not('wallet', 'is', null),
          db.from('beta_reviews').select('wallet,stars').not('wallet', 'is', null),
        ]);
        if (miners.error) throw miners.error;
        const count = (rows: any[] | null, k: string) => { const o: Record<string, number> = {}; for (const r of rows ?? []) if (r[k]) o[r[k]] = (o[r[k]] ?? 0) + 1; return o; };
        const latest: Record<string, any> = {}, week: Record<string, number> = {};
        for (const d of days.data ?? []) { latest[d.wallet] ??= d; week[d.wallet] = (week[d.wallet] ?? 0) + Math.max(0, Number(d.pts_close) - Number(d.pts_open)); }
        const fm = Object.fromEntries((founding.data ?? []).map((f) => [f.wallet, f]));
        const cm = Object.fromEntries((certs.data ?? []).map((c) => [c.wallet, c]));
        const ko = count(kos.data, 'killer'), died = count(kos.data, 'victim'), won = count(wins.data, 'winner');
        const said = count(chat.data, 'wallet'), bugN = count(bugs.data, 'wallet'), revN = count(reviews.data, 'wallet');
        const mutedSet = new Set((muted.data ?? []).map((m) => m.wallet));
        const team = new Set(((await db.from('team_members').select('wallet')).data ?? []).map((m) => m.wallet));
        const players = (miners.data ?? []).map((m) => ({
          ...m,
          ore: latest[m.wallet] ? Number(latest[m.wallet].ore_close) : null,
          pts7: week[m.wallet] ?? 0,
          founding: fm[m.wallet] ? { rounds: fm[m.wallet].rounds, done: fm[m.wallet].done } : null,
          cert: cm[m.wallet] ? { serial: cm[m.wallet].serial, status: cm[m.wallet].status } : null,
          kos: m.name ? ko[m.name] ?? 0 : 0, deaths: m.name ? died[m.name] ?? 0 : 0, wins: m.name ? won[m.name] ?? 0 : 0,
          chat: said[m.wallet] ?? 0, muted: mutedSet.has(m.wallet), bugs: bugN[m.wallet] ?? 0, reviews: revN[m.wallet] ?? 0, team: team.has(m.wallet),
        }));
        return reply(200, { players });
      }
      case 'player': {
        const wallet = clean(body.wallet, 44);
        if (!WALLET_RE.test(wallet)) return reply(400, { error: 'Bad wallet.' });
        const { data: m } = await db.from('gali_miners').select('*').eq('wallet', wallet).maybeSingle();
        if (!m) return reply(404, { error: 'No miner with that wallet.' });
        const [days, chat, bugs, reviews, kos, wins, dmOut, dmIn] = await Promise.all([
          db.from('gali_miner_days').select('*').eq('wallet', wallet).order('day', { ascending: false }).limit(60),
          db.from('lobby_chat').select('id,at,body,hidden').eq('wallet', wallet).order('id', { ascending: false }).limit(30),
          db.from('beta_bugs').select('id,title,severity,status,created_at').eq('wallet', wallet).order('id', { ascending: false }).limit(30),
          db.from('beta_reviews').select('id,stars,loved,wish,updated_at').eq('wallet', wallet).limit(5),
          m.name ? db.from('brawl_kos').select('at,killer,victim,scope').or(`killer.eq.${JSON.stringify(m.name)},victim.eq.${JSON.stringify(m.name)}`).order('at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
          m.name ? db.from('brawl_wins').select('at,mode,players').eq('winner', m.name).order('at', { ascending: false }).limit(20) : Promise.resolve({ data: [] }),
          db.from('dms').select('id', { count: 'exact', head: true }).eq('sender', wallet),
          db.from('dms').select('id', { count: 'exact', head: true }).eq('recipient', wallet),
        ]);
        return reply(200, {
          player: m, days: days.data ?? [], chat: chat.data ?? [], bugs: bugs.data ?? [], reviews: reviews.data ?? [],
          kos: (kos as any).data ?? [], wins: (wins as any).data ?? [], dms: { sent: dmOut.count ?? 0, received: dmIn.count ?? 0 },
        });
      }

      default:
        return reply(400, { error: 'unknown action' });
    }
  } catch (e) {
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
