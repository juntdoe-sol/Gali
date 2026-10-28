// Gali TV admin calls. One signed login gives a 12-hour session; files go straight to Supabase Storage
// through signed upload URLs that the tv-admin function hands out to admin sessions only.
// tv-admin checks the wallet session itself (verify_jwt off), so the page needs no Supabase key.
export const TV_URL = 'https://rckvfpwtdyvvvjqqlffn.supabase.co';
export const TV_PAGE = 'https://galitv.bounded.page';
export const TV_MAX_BYTES = 50 * 1024 * 1024;
export const tvFile = (path: string | null) => (path ? `${TV_URL}/storage/v1/object/public/gali-tv/${path}` : '');

export type Series = 'cartoon' | 'team';
export interface TvVideo {
  id: string;
  series: Series;
  title: string;
  description: string;
  episode: number | null;
  video_path: string;
  poster_path: string | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
  tiktok_url: string | null;
  published: boolean;
  created_at: string;
}

type SignMessage = (message: Uint8Array) => Promise<Uint8Array>;
const SESSION_KEY = 'gali-tv-session';
const toBase64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const r = await fetch(`${TV_URL}/functions/v1/tv-admin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && body.action !== 'login') sessionStorage.removeItem(SESSION_KEY);
  if (!r.ok) throw new Error(j.error ?? `Gali TV server error ${r.status}`);
  return j as T;
}

/** A saved session for this wallet that has at least a minute left, or null. */
export function savedSession(wallet: string) {
  const s = sessionStorage.getItem(SESSION_KEY) ?? '';
  const [w, exp] = s.split('.');
  return w === wallet && Number(exp) > Date.now() + 60_000 ? s : null;
}

export async function tvLogin(wallet: string, signMessage: SignMessage) {
  const ts = Date.now();
  const sig = await signMessage(new TextEncoder().encode(`gali-tv:login:${ts}`));
  const { session } = await call<{ session: string }>({ action: 'login', wallet, ts, sig: toBase64(sig) });
  sessionStorage.setItem(SESSION_KEY, session);
  return session;
}

export const tvList = (session: string) => call<{ videos: TvVideo[] }>({ action: 'list', session }).then((r) => r.videos);
export const tvUpdate = (session: string, id: string, patch: Partial<TvVideo>) => call<{ video: TvVideo }>({ action: 'update', session, id, ...patch });
export const tvDelete = (session: string, id: string) => call({ action: 'delete', session, id });

/** PUT a file to a signed upload URL, reporting progress from 0 to 1. */
function put(url: string, file: Blob, onProgress: (f: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('PUT', url);
    x.setRequestHeader('Content-Type', file.type);
    x.setRequestHeader('x-upsert', 'false');
    x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Upload failed (${x.status}): ${x.responseText.slice(0, 160)}`)));
    x.onerror = () => reject(new Error('Upload failed: network error'));
    x.send(file);
  });
}

export interface NewVideo {
  series: Series;
  title: string;
  description: string;
  episode: number | null;
  tiktok_url: string;
  published: boolean;
  file: File;
  poster: Blob | null;
  duration_s: number | null;
  width: number | null;
  height: number | null;
}

export async function tvUpload(session: string, v: NewVideo, onProgress: (f: number) => void) {
  const slots = await call<{ video: { path: string; url: string }; poster: { path: string; url: string } | null }>({
    action: 'upload',
    session,
    series: v.series,
    videoType: v.file.type,
    posterType: v.poster?.type ?? '',
  });
  if (v.poster && slots.poster) await put(slots.poster.url, v.poster, () => {});
  await put(slots.video.url, v.file, onProgress);
  return call<{ video: TvVideo }>({
    action: 'create',
    session,
    series: v.series,
    title: v.title,
    description: v.description,
    episode: v.episode,
    tiktok_url: v.tiktok_url,
    published: v.published,
    video_path: slots.video.path,
    poster_path: slots.poster?.path ?? null,
    duration_s: v.duration_s,
    width: v.width,
    height: v.height,
  });
}
