// The notice board on docs.gali.lol (#board): anonymous ideas, replies and up/down votes.
// No sign-in. Each browser keeps a random secret token; the miner id shown on the board is a salted hash of it,
// so nobody can post or vote as someone else without that browser's token. IPs are stored only as salted hashes.
// Team members read and remove posts on the admin page (team function: board, board-hide, board-delete).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, reply } from '../_shared/solana.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY);
const TAGS = ['idea', 'island', 'lobby', 'arcade', 'gear'];
const HOUR = 3600_000;
const POSTS_PER_HOUR = 12;    // per miner
const REPLIES_PER_HOUR = 30;  // per miner
const WRITES_PER_NETWORK = 60; // posts + replies an hour from one connection, so new tokens can't flood the board

const sha = async (s: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const salted = (kind: string, v: string) => sha(`gali-board:${kind}:${v}:${SERVICE_KEY.slice(-24)}`);
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || req.headers.get('cf-connecting-ip') || '';
const text = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const newId = (p: string) => p + Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('');
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);
const ago = () => new Date(Date.now() - HOUR).toISOString();

async function countSince(table: string, col: string, v: string) {
  const { count, error } = await db.from(table).select('id', { count: 'exact', head: true }).eq(col, v).gte('created_at', ago());
  if (error) throw error;
  return count ?? 0;
}
async function networkWrites(ip_hash: string | null) {
  if (!ip_hash) return 0;
  return (await countSince('board_posts', 'ip_hash', ip_hash)) + (await countSince('board_replies', 'ip_hash', ip_hash));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return reply(405, { error: 'POST only' });
  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const token = String(body.token ?? '');
    if (!/^[a-z0-9]{24,64}$/i.test(token)) return reply(400, { error: 'bad token' });
    const me = (await salted('miner', token)).slice(0, 24);

    if (action === 'list') {
      const { data: posts, error } = await db.from('board_posts').select('id,author_id,title,body,tag,created_at')
        .eq('hidden', false).order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      const ids = (posts ?? []).map((p) => p.id);
      const score: Record<string, number> = {}, talk: Record<string, number> = {}, myVote: Record<string, number> = {};
      if (ids.length) {
        const [{ data: votes, error: ve }, { data: reps, error: re }] = await Promise.all([
          db.from('board_votes').select('post_id,voter_id,value').in('post_id', ids),
          db.from('board_replies').select('post_id').in('post_id', ids),
        ]);
        if (ve) throw ve;
        if (re) throw re;
        for (const v of votes ?? []) { score[v.post_id] = (score[v.post_id] || 0) + v.value; if (v.voter_id === me) myVote[v.post_id] = v.value; }
        for (const r of reps ?? []) talk[r.post_id] = (talk[r.post_id] || 0) + 1;
      }
      const list = (posts ?? []).map((p) => ({ id: p.id, authorId: p.author_id, title: p.title, body: p.body, tag: p.tag, at: secs(p.created_at), score: score[p.id] || 0, replies: talk[p.id] || 0 }));
      return reply(200, { me, list, myVote });
    }

    if (action === 'replies') {
      const { data, error } = await db.from('board_replies').select('id,post_id,author_id,body,created_at')
        .eq('post_id', String(body.post_id ?? '')).order('created_at').limit(100);
      if (error) throw error;
      return reply(200, { rows: (data ?? []).map((r) => ({ id: r.id, suggestionId: r.post_id, authorId: r.author_id, body: r.body, at: secs(r.created_at) })) });
    }

    const ip = ipOf(req);
    const ip_hash = ip ? await salted('ip', ip) : null;

    if (action === 'post') {
      const title = text(body.title, 90), text_ = String(body.body ?? '').trim().slice(0, 600), tag = String(body.tag ?? 'idea');
      if (title.length < 4) return reply(400, { error: 'Give your idea at least 4 characters.' });
      if (!TAGS.includes(tag)) return reply(400, { error: 'Pick a place for your idea.' });
      if ((await countSince('board_posts', 'author_id', me)) >= POSTS_PER_HOUR) return reply(429, { error: 'posts_per_hour' });
      if ((await networkWrites(ip_hash)) >= WRITES_PER_NETWORK) return reply(429, { error: 'posts_per_hour' });
      const row = { id: newId('s'), author_id: me, title, body: text_, tag, ip_hash };
      const { data, error } = await db.from('board_posts').insert(row).select('created_at').single();
      if (error) throw error;
      return reply(200, { id: row.id, authorId: me, title, body: text_, tag, at: secs(data.created_at), score: 0, replies: 0 });
    }

    if (action === 'reply') {
      const post_id = String(body.post_id ?? ''), text_ = String(body.body ?? '').trim().slice(0, 400);
      if (!text_) return reply(400, { error: 'Write a reply first.' });
      const { data: post } = await db.from('board_posts').select('id').eq('id', post_id).eq('hidden', false).maybeSingle();
      if (!post) return reply(404, { error: 'That idea is gone.' });
      if ((await countSince('board_replies', 'author_id', me)) >= REPLIES_PER_HOUR) return reply(429, { error: 'posts_per_hour' });
      if ((await networkWrites(ip_hash)) >= WRITES_PER_NETWORK) return reply(429, { error: 'posts_per_hour' });
      const row = { id: newId('r'), post_id, author_id: me, body: text_, ip_hash };
      const { data, error } = await db.from('board_replies').insert(row).select('created_at').single();
      if (error) throw error;
      return reply(200, { id: row.id, suggestionId: post_id, authorId: me, body: text_, at: secs(data.created_at) });
    }

    if (action === 'vote') {
      const post_id = String(body.post_id ?? ''), value = Number(body.value);
      if (![-1, 0, 1].includes(value)) return reply(400, { error: 'bad vote' });
      if (value === 0) {
        const { error } = await db.from('board_votes').delete().eq('post_id', post_id).eq('voter_id', me);
        if (error) throw error;
      } else {
        const { error } = await db.from('board_votes').upsert({ post_id, voter_id: me, value }, { onConflict: 'post_id,voter_id' });
        if (error) throw error;
      }
      return reply(200, { ok: true });
    }

    if (action === 'remove') {
      const { error } = await db.from('board_posts').delete().eq('id', String(body.post_id ?? '')).eq('author_id', me);
      if (error) throw error;
      return reply(200, { ok: true });
    }

    return reply(400, { error: 'unknown action' });
  } catch (e) {
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
