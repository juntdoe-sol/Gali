import { useWallet } from '@solana/wallet-adapter-react';
import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import type { Notice } from './App';
import { savedSession, tvDelete, tvFile, tvList, tvLogin, TV_MAX_BYTES, TV_PAGE, tvUpdate, tvUpload, type Series, type TvVideo } from './tv';

const SERIES: { id: Series; name: string; hint: string }[] = [
  { id: 'cartoon', name: 'Matt the Miner', hint: 'CH 1 · cartoon episodes (vertical, phone-size)' },
  { id: 'team', name: 'Team update', hint: 'CH 2 · news and devlogs' },
];
const mb = (b: number) => `${(b / 1024 / 1024).toFixed(1)} MB`;
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Grab the frame at `t` seconds from a video element as a JPEG. */
function grabFrame(v: HTMLVideoElement): Promise<Blob | null> {
  const w = v.videoWidth, h = v.videoHeight;
  if (!w || !h) return Promise.resolve(null);
  const scale = Math.min(1, 960 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale);
  c.height = Math.round(h * scale);
  c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
  return new Promise((r) => c.toBlob(r, 'image/jpeg', 0.86));
}

export function TvTab({ setNotice }: { setNotice: (n: Notice | null) => void }) {
  const { publicKey, signMessage } = useWallet();
  const wallet = publicKey?.toBase58() ?? '';
  const [session, setSession] = useState<string | null>(() => (wallet ? savedSession(wallet) : null));
  const [videos, setVideos] = useState<TvVideo[] | null>(null);

  useEffect(() => setSession(wallet ? savedSession(wallet) : null), [wallet]);

  const refresh = useCallback(async (s: string) => {
    try {
      setVideos(await tvList(s));
    } catch (e) {
      setNotice({ tone: 'err', text: `Could not load Gali TV: ${String((e as Error).message ?? e)}` });
      if (!savedSession(wallet)) setSession(null);
    }
  }, [setNotice, wallet]);

  useEffect(() => {
    if (session) void refresh(session);
  }, [session, refresh]);

  if (!publicKey || !signMessage)
    return (
      <section className="card">
        <h2>Gali TV</h2>
        <p className="hint">Connect a Gali TV admin wallet that can sign messages to upload videos.</p>
      </section>
    );

  if (!session)
    return (
      <section className="card tv-login">
        <h2>Gali TV</h2>
        <p className="hint">Sign one message to start a 12-hour admin session. Nothing is sent on-chain and it costs nothing.</p>
        <button
          onClick={async () => {
            setNotice({ tone: 'busy', text: 'Signing in to Gali TV… sign the message in your wallet' });
            try {
              setSession(await tvLogin(wallet, signMessage));
              setNotice({ tone: 'ok', text: 'Signed in to Gali TV' });
            } catch (e) {
              setNotice({ tone: 'err', text: `Sign in failed: ${String((e as Error).message ?? e)}` });
            }
          }}
        >
          Sign in to Gali TV
        </button>
      </section>
    );

  return (
    <div className="tv-admin">
      <Uploader session={session} setNotice={setNotice} onDone={() => void refresh(session)} nextEpisode={nextEpisode(videos)} />
      <Library session={session} videos={videos} setNotice={setNotice} onChange={() => void refresh(session)} />
    </div>
  );
}

const nextEpisode = (vs: TvVideo[] | null) => (vs ?? []).filter((v) => v.series === 'cartoon' && v.episode != null).reduce((m, v) => Math.max(m, v.episode! + 1), 1);

function Uploader({ session, setNotice, onDone, nextEpisode }: { session: string; setNotice: (n: Notice | null) => void; onDone: () => void; nextEpisode: number }) {
  const [series, setSeries] = useState<Series>('cartoon');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [meta, setMeta] = useState<{ d: number; w: number; h: number } | null>(null);
  const [posterAt, setPosterAt] = useState(1);
  const [poster, setPoster] = useState<{ blob: Blob; url: string } | null>(null);
  const [title, setTitle] = useState('');
  const [episode, setEpisode] = useState('');
  const [description, setDescription] = useState('');
  const [tiktok, setTiktok] = useState('');
  const [published, setPublished] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const vid = useRef<HTMLVideoElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);
  useEffect(() => () => { if (poster) URL.revokeObjectURL(poster.url); }, [poster]);
  useEffect(() => { if (series === 'cartoon' && !episode) setEpisode(String(nextEpisode)); }, [series, nextEpisode, episode]);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!/^video\/(mp4|webm|quicktime)$/.test(f.type)) return setNotice({ tone: 'err', text: 'Pick an MP4, WebM or MOV video.' });
    if (f.size > TV_MAX_BYTES) return setNotice({ tone: 'err', text: `That video is ${mb(f.size)}. The limit is ${mb(TV_MAX_BYTES)}; export it smaller (TikTok-size 1080p is usually 10 to 30 MB).` });
    setFile(f);
    setUrl(URL.createObjectURL(f));
    setMeta(null);
    setPoster(null);
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim());
  };

  const capture = async () => {
    const v = vid.current;
    if (!v) return;
    const blob = await grabFrame(v);
    if (blob) setPoster({ blob, url: URL.createObjectURL(blob) });
  };

  const onMeta = () => {
    const v = vid.current!;
    setMeta({ d: v.duration, w: v.videoWidth, h: v.videoHeight });
    const t = Math.min(1, v.duration / 3);
    setPosterAt(t);
    v.currentTime = t;
  };

  const reset = () => {
    setFile(null);
    setUrl('');
    setMeta(null);
    setPoster(null);
    setTitle('');
    setEpisode('');
    setDescription('');
    setTiktok('');
    setProgress(null);
  };

  const submit = async () => {
    if (!file || !title.trim()) return;
    if (tiktok && !/^https:\/\/(www\.|vm\.|vt\.)?tiktok\.com\//.test(tiktok.trim())) return setNotice({ tone: 'err', text: 'The TikTok link should start with https://www.tiktok.com/ or https://vm.tiktok.com/' });
    setProgress(0);
    setNotice({ tone: 'busy', text: `Uploading ${file.name}…` });
    try {
      const posterBlob = poster?.blob ?? (vid.current ? await grabFrame(vid.current) : null);
      await tvUpload(
        session,
        {
          series,
          title: title.trim(),
          description: description.trim(),
          episode: series === 'cartoon' && episode !== '' ? Number(episode) : null,
          tiktok_url: tiktok.trim(),
          published,
          file,
          poster: posterBlob,
          duration_s: meta?.d ?? null,
          width: meta?.w ?? null,
          height: meta?.h ?? null,
        },
        setProgress,
      );
      setNotice({ tone: 'ok', text: published ? `"${title.trim()}" is live on Gali TV and plays first for new visitors.` : `"${title.trim()}" uploaded as a draft.` });
      reset();
      onDone();
    } catch (e) {
      setProgress(null);
      setNotice({ tone: 'err', text: `Upload failed: ${String((e as Error).message ?? e)}` });
    }
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files[0]);
  };
  const busy = progress !== null;

  return (
    <section className="card tv-upload">
      <h2>Upload a video</h2>
      <p className="hint">The newest published video autoplays on Gali TV. Vertical TikTok videos are fine: the TV frames them for you.</p>

      <div className="tv-series" role="radiogroup" aria-label="Series">
        {SERIES.map((s) => (
          <button key={s.id} role="radio" aria-checked={series === s.id} className={`tv-series-opt ${s.id} ${series === s.id ? 'on' : ''}`} onClick={() => setSeries(s.id)} disabled={busy}>
            <b>{s.name}</b>
            <span>{s.hint}</span>
          </button>
        ))}
      </div>

      {!file ? (
        <div
          className={`tv-drop ${over ? 'over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
          onClick={() => input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          <div className="tv-drop-icon" aria-hidden>▶</div>
          <b>Drop a video here, or click to choose</b>
          <span>MP4, WebM or MOV · up to {mb(TV_MAX_BYTES)}</span>
          <input ref={input} type="file" accept="video/mp4,video/webm,video/quicktime" hidden onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      ) : (
        <div className="tv-compose">
          <div className="tv-preview">
            <div className={`tv-frame ${meta && meta.h > meta.w ? 'tall' : ''}`}>
              <video ref={vid} src={url} muted playsInline preload="auto" onLoadedMetadata={onMeta} controls={false} />
            </div>
            {meta ? (
              <>
                <label className="tv-scrub">
                  <span>Poster frame · {clock(posterAt)}</span>
                  <input
                    type="range"
                    min={0}
                    max={meta.d}
                    step={0.04}
                    value={posterAt}
                    onChange={(e) => {
                      const t = Number(e.target.value);
                      setPosterAt(t);
                      if (vid.current) vid.current.currentTime = t;
                    }}
                    disabled={busy}
                  />
                </label>
                <div className="row">
                  <button className="small ghost" onClick={() => void capture()} disabled={busy}>
                    {poster ? 'Use this frame instead' : 'Use this frame as the poster'}
                  </button>
                  {poster ? <img className="tv-poster-thumb" src={poster.url} alt="Chosen poster" /> : <span className="hint">Otherwise this frame is used.</span>}
                </div>
                <p className="hint">
                  {file.name} · {mb(file.size)} · {clock(meta.d)} · {meta.w}×{meta.h} {meta.h > meta.w ? '(vertical)' : ''}
                </p>
              </>
            ) : (
              <p className="hint">Reading the video…</p>
            )}
          </div>

          <div className="tv-fields">
            <label>
              Title
              <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={series === 'cartoon' ? 'The Motherlode' : 'Devlog: what shipped this week'} disabled={busy} />
            </label>
            {series === 'cartoon' ? (
              <label>
                Episode number
                <input value={episode} inputMode="numeric" onChange={(e) => setEpisode(e.target.value.replace(/\D/g, '').slice(0, 4))} disabled={busy} />
              </label>
            ) : null}
            <label>
              Description <small className="hint">(optional)</small>
              <textarea value={description} maxLength={600} rows={3} onChange={(e) => setDescription(e.target.value)} placeholder="One or two lines shown under the TV" disabled={busy} />
            </label>
            <label>
              TikTok link <small className="hint">(optional)</small>
              <input value={tiktok} onChange={(e) => setTiktok(e.target.value)} placeholder="https://www.tiktok.com/@gali_world/video/…" disabled={busy} />
            </label>
            <label className="tv-check">
              <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} disabled={busy} />
              Publish now (untick to save a hidden draft)
            </label>

            {busy ? (
              <div className="tv-progress" role="progressbar" aria-valuenow={Math.round((progress ?? 0) * 100)} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
                <span>{progress! < 1 ? `Uploading ${Math.round(progress! * 100)}%` : 'Saving…'}</span>
              </div>
            ) : (
              <div className="row">
                <button onClick={() => void submit()} disabled={!title.trim() || !meta}>
                  {published ? 'Upload and go live' : 'Upload as draft'}
                </button>
                <button className="ghost" onClick={reset}>
                  Choose another video
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Library({ session, videos, setNotice, onChange }: { session: string; videos: TvVideo[] | null; setNotice: (n: Notice | null) => void; onChange: () => void }) {
  const [filter, setFilter] = useState<'all' | Series>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState({ title: '', description: '', episode: '', tiktok_url: '' });

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setNotice({ tone: 'busy', text: `${label}…` });
    try {
      await fn();
      setNotice({ tone: 'ok', text: `${label}: done` });
      onChange();
    } catch (e) {
      setNotice({ tone: 'err', text: `${label} failed: ${String((e as Error).message ?? e)}` });
    }
  };

  const shown = (videos ?? []).filter((v) => filter === 'all' || v.series === filter);
  const latestLive = (videos ?? []).find((v) => v.published)?.id;

  return (
    <section className="card tv-library">
      <div className="tv-lib-head">
        <h2>On Gali TV {videos ? `(${videos.length})` : ''}</h2>
        <div className="row">
          {(['all', 'cartoon', 'team'] as const).map((f) => (
            <button key={f} className={`small ${filter === f ? '' : 'ghost'}`} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'cartoon' ? 'Matt the Miner' : 'Team'}
            </button>
          ))}
          <a className="tv-open" href={TV_PAGE} target="_blank" rel="noreferrer">
            Open Gali TV ↗
          </a>
        </div>
      </div>
      {!videos ? <p className="hint">Loading…</p> : null}
      {videos && !shown.length ? <p className="hint">No videos here yet. Upload one above.</p> : null}
      <ul className="tv-list">
        {shown.map((v) => (
          <li key={v.id} className={v.published ? '' : 'draft'}>
            <a className="tv-thumb" href={`${TV_PAGE}/?v=${v.id}`} target="_blank" rel="noreferrer" aria-label={`Watch ${v.title} on Gali TV`}>
              {v.poster_path ? <img src={tvFile(v.poster_path)} alt="" loading="lazy" /> : <video src={`${tvFile(v.video_path)}#t=1`} muted preload="metadata" />}
              {v.duration_s ? <span>{clock(Number(v.duration_s))}</span> : null}
            </a>
            {editing === v.id ? (
              <div className="tv-edit">
                <input value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} aria-label="Title" />
                {v.series === 'cartoon' ? <input value={draft.episode} onChange={(e) => setDraft({ ...draft, episode: e.target.value.replace(/\D/g, '') })} aria-label="Episode number" placeholder="Episode" /> : null}
                <textarea value={draft.description} rows={2} maxLength={600} onChange={(e) => setDraft({ ...draft, description: e.target.value })} aria-label="Description" placeholder="Description" />
                <input value={draft.tiktok_url} onChange={(e) => setDraft({ ...draft, tiktok_url: e.target.value })} aria-label="TikTok link" placeholder="TikTok link" />
                <div className="row">
                  <button
                    className="small"
                    disabled={!draft.title.trim()}
                    onClick={() =>
                      void act('Save changes', () =>
                        tvUpdate(session, v.id, {
                          title: draft.title.trim(),
                          description: draft.description.trim(),
                          episode: v.series === 'cartoon' && draft.episode !== '' ? Number(draft.episode) : null,
                          tiktok_url: draft.tiktok_url.trim() || null,
                        }),
                      ).then(() => setEditing(null))
                    }
                  >
                    Save
                  </button>
                  <button className="small ghost" onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="tv-info">
                <div className="meta">
                  <span className={`tag ${v.series === 'cartoon' ? 'gold' : 'live'}`}>{v.series === 'cartoon' ? `Matt the Miner${v.episode != null ? ` · Ep ${v.episode}` : ''}` : 'Team'}</span>
                  {v.published ? null : <span className="tag bad">draft</span>}
                  {v.id === latestLive ? <span className="tag ok">autoplays first</span> : null}
                  <span className="hint">{new Date(v.created_at).toLocaleString()}</span>
                </div>
                <b>{v.title}</b>
                {v.description ? <p className="hint">{v.description}</p> : null}
                <div className="row">
                  <button className="small ghost" onClick={() => void act(v.published ? 'Hide video' : 'Publish video', () => tvUpdate(session, v.id, { published: !v.published }))}>
                    {v.published ? 'Hide' : 'Publish'}
                  </button>
                  <button
                    className="small ghost"
                    onClick={() => {
                      setDraft({ title: v.title, description: v.description, episode: v.episode != null ? String(v.episode) : '', tiktok_url: v.tiktok_url ?? '' });
                      setEditing(v.id);
                    }}
                  >
                    Edit
                  </button>
                  <button className="small danger" onClick={() => confirm(`Delete "${v.title}" for good? The video file is removed too.`) && void act('Delete video', () => tvDelete(session, v.id))}>
                    Delete
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
