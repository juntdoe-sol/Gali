// Gali TV admin. An admin wallet signs one login message (signMessage); the reply is a 12-hour session
// that every other action carries, so an upload needs one wallet approval, not one per step.
// Admin wallets are rows in gali_tv_admins. Uploads go straight to Storage through signed upload URLs.
// Channels: cartoon (Matt the Miner), team (Team Updates), fan (Memes & Fan Art: videos or pictures, with a credit).
// Fan art sent in from tv.gali.lol (tv-submit) waits in the private gali-tv-submissions bucket until an admin approves it here.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { cors, reply, verify } from '../_shared/solana.ts';

const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(Deno.env.get('SUPABASE_URL')!, SERVICE_KEY);
const BUCKET = 'gali-tv';
const SUBS = 'gali-tv-submissions';
const SESSION_MS = 12 * 3600_000;
const SERIES = ['cartoon', 'team', 'fan'];
const VIDEO_EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov' };
const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
let keyP: Promise<CryptoKey> | null = null;
const sessionKey = () =>
  (keyP ??= crypto.subtle
    .digest('SHA-256', enc.encode(`gali-tv-session:${SERVICE_KEY}`))
    .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])));
const tagOf = async (wallet: string, exp: number) => hex(await crypto.subtle.sign('HMAC', await sessionKey(), enc.encode(`${wallet}.${exp}`)));

async function isAdmin(wallet: string) {
  const { data, error } = await db.from('gali_tv_admins').select('wallet').eq('wallet', wallet).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/** The wallet behind a valid, unexpired session that is still on the admin list, or null. */
async function sessionWallet(session: unknown) {
  const [wallet, exp, tag] = String(session ?? '').split('.');
  if (!wallet || !exp || !tag || Number(exp) < Date.now()) return null;
  if ((await tagOf(wallet, Number(exp))) !== tag) return null;
  return (await isAdmin(wallet)) ? wallet : null;
}

/** Rewrite feed.json: the published videos, newest first. The TV page reads this file from the CDN, so
 * visitors never need an API key or hit the database. */
async function publishFeed() {
  const { data, error } = await db
    .from('gali_tv_videos')
    .select('id,series,title,description,episode,video_path,poster_path,duration_s,width,height,tiktok_url,credit,created_at')
    .eq('published', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  const body = new Blob([JSON.stringify({ updated_at: new Date().toISOString(), videos: data })], { type: 'application/json' });
  const up = await db.storage.from(BUCKET).upload('feed.json', body, { upsert: true, contentType: 'application/json', cacheControl: '15' });
  if (up.error) throw up.error;
}

const clean = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const intOrNull = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.max(0, Math.floor(Number(v))) || 0);
const numOrNull = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);
const tiktok = (v: unknown) => {
  const s = clean(v, 300);
  return /^https:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//.test(s) ? s : null;
};
/** Who made a meme or a piece of fan art: an X handle (kept with its @) or a short name. */
const creditOf = (v: unknown) => {
  const s = clean(v, 40).replace(/[<>]/g, '');
  return s || null;
};
/** Only paths this function handed out can be saved on a row. */
const ownPath = (v: unknown, dir: string) => {
  const s = String(v ?? '');
  return new RegExp(`^${dir}/[0-9a-f-]{36}\\.[a-z0-9]{3,4}$`).test(s) ? s : null;
};

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
      if (!wallet || !body.sig || !verify(String(body.sig), `gali-tv:login:${ts}`, wallet)) return reply(401, { error: 'bad signature' });
      if (!(await isAdmin(wallet))) return reply(403, { error: 'This wallet is not a Gali TV admin.' });
      const exp = Date.now() + SESSION_MS;
      return reply(200, { session: `${wallet}.${exp}.${await tagOf(wallet, exp)}`, expires: exp });
    }

    const admin = await sessionWallet(body.session);
    if (!admin) return reply(401, { error: 'Sign in again.' });

    switch (action) {
      case 'publish-feed': {
        await publishFeed();
        return reply(200, { ok: true });
      }
      case 'list': {
        const { data, error } = await db.from('gali_tv_videos').select('*').order('created_at', { ascending: false });
        if (error) throw error;
        return reply(200, { videos: data });
      }
      case 'upload': {
        // one signed URL for the video (or the picture, on Memes & Fan Art), and one for the poster when the page made one
        const series = SERIES.includes(body.series) ? body.series : null;
        if (!series) return reply(400, { error: 'Pick a series.' });
        const type = String(body.videoType);
        const vExt = VIDEO_EXT[type] ?? (series === 'fan' ? IMAGE_EXT[type] : undefined);
        if (!vExt) {
          return reply(400, { error: series === 'fan' ? 'Upload an MP4, WebM or MOV video, or a PNG, JPG or WebP picture.' : 'Upload an MP4, WebM or MOV video.' });
        }
        const id = crypto.randomUUID();
        const video = await db.storage.from(BUCKET).createSignedUploadUrl(`${series}/${id}.${vExt}`);
        if (video.error) throw video.error;
        let poster = null;
        const pExt = IMAGE_EXT[String(body.posterType)];
        if (pExt && !IMAGE_EXT[type]) {
          const p = await db.storage.from(BUCKET).createSignedUploadUrl(`posters/${id}.${pExt}`);
          if (p.error) throw p.error;
          poster = { path: p.data.path, url: p.data.signedUrl };
        }
        return reply(200, { video: { path: video.data.path, url: video.data.signedUrl }, poster });
      }
      case 'create': {
        const series = SERIES.includes(body.series) ? body.series : null;
        const video_path = ownPath(body.video_path, String(series));
        if (!series || !video_path) return reply(400, { error: 'Upload the video first.' });
        const title = clean(body.title, 120);
        if (!title) return reply(400, { error: 'Give the video a title.' });
        const { data, error } = await db
          .from('gali_tv_videos')
          .insert({
            series,
            title,
            description: clean(body.description, 600),
            episode: series === 'cartoon' ? intOrNull(body.episode) : null,
            video_path,
            poster_path: ownPath(body.poster_path, 'posters'),
            duration_s: numOrNull(body.duration_s),
            width: intOrNull(body.width),
            height: intOrNull(body.height),
            tiktok_url: tiktok(body.tiktok_url),
            credit: series === 'fan' ? creditOf(body.credit) : null,
            published: body.published !== false,
          })
          .select()
          .single();
        if (error) throw error;
        await publishFeed();
        return reply(200, { video: data });
      }
      case 'update': {
        const patch: Record<string, unknown> = {};
        if ('title' in body) patch.title = clean(body.title, 120);
        if ('description' in body) patch.description = clean(body.description, 600);
        if ('episode' in body) patch.episode = intOrNull(body.episode);
        if ('tiktok_url' in body) patch.tiktok_url = tiktok(body.tiktok_url);
        if ('credit' in body) patch.credit = creditOf(body.credit);
        if ('published' in body) patch.published = Boolean(body.published);
        if (patch.title === '') return reply(400, { error: 'Give the video a title.' });
        const { data, error } = await db.from('gali_tv_videos').update(patch).eq('id', String(body.id)).select().single();
        if (error) throw error;
        await publishFeed();
        return reply(200, { video: data });
      }
      case 'delete': {
        const { data, error } = await db.from('gali_tv_videos').delete().eq('id', String(body.id)).select().single();
        if (error) throw error;
        const files = [data.video_path, data.poster_path].filter(Boolean);
        if (files.length) await db.storage.from(BUCKET).remove(files);
        await publishFeed();
        return reply(200, { ok: true });
      }
      // ---------- fan art sent in from tv.gali.lol ----------
      case 'subs': {
        const { data, error } = await db.from('gali_tv_submissions')
          .select('id,wallet,title,credit,description,file_path,file_type,file_size,width,height,duration_s,status,reason,video_id,reviewed_at,created_at')
          .neq('status', 'uploading').gte('created_at', new Date(Date.now() - 30 * 864e5).toISOString())
          .order('created_at', { ascending: false }).limit(200);
        if (error) throw error;
        const pending = data.filter((s) => s.status === 'pending');
        const urls: Record<string, string> = {};
        if (pending.length) {
          const { data: signed } = await db.storage.from(SUBS).createSignedUrls(pending.map((s) => s.file_path), 3600);
          for (const x of signed ?? []) if (x.path && x.signedUrl) urls[x.path] = x.signedUrl;
        }
        return reply(200, { subs: data.map((s) => ({ ...s, url: urls[s.file_path] ?? null })) });
      }
      case 'sub-approve': {
        const { data: s } = await db.from('gali_tv_submissions').select('*').eq('id', String(body.id)).maybeSingle();
        if (!s || s.status !== 'pending') return reply(404, { error: 'That submission is not waiting for review.' });
        const ext = s.file_path.split('.').pop();
        const dest = `fan/${crypto.randomUUID()}.${ext}`;
        const cp = await db.storage.from(SUBS).copy(s.file_path, dest, { destinationBucket: BUCKET });
        if (cp.error) throw cp.error;
        const title = clean(body.title ?? s.title, 120) || s.title;
        const { data: v, error } = await db.from('gali_tv_videos').insert({
          series: 'fan', title, description: clean(body.description ?? s.description, 600), video_path: dest,
          duration_s: numOrNull(s.duration_s), width: intOrNull(s.width), height: intOrNull(s.height),
          credit: creditOf(body.credit ?? s.credit), published: true,
        }).select('id').single();
        if (error) throw error;
        await db.from('gali_tv_submissions').update({ status: 'approved', video_id: v.id, reviewed_by: admin, reviewed_at: new Date().toISOString() }).eq('id', s.id);
        await db.storage.from(SUBS).remove([s.file_path]);
        await publishFeed();
        return reply(200, { ok: true, video_id: v.id });
      }
      case 'sub-reject': {
        const { data: s } = await db.from('gali_tv_submissions').select('id,file_path,status').eq('id', String(body.id)).maybeSingle();
        if (!s || s.status !== 'pending') return reply(404, { error: 'That submission is not waiting for review.' });
        await db.from('gali_tv_submissions').update({ status: 'rejected', reason: clean(body.reason, 200) || null, reviewed_by: admin, reviewed_at: new Date().toISOString() }).eq('id', s.id);
        await db.storage.from(SUBS).remove([s.file_path]);
        return reply(200, { ok: true });
      }
      default:
        return reply(400, { error: 'unknown action' });
    }
  } catch (e) {
    return reply(500, { error: String((e as Error).message ?? e) });
  }
});
