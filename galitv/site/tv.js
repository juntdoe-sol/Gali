// Gali TV: plays the published videos on a pixel CRT, or on a Seeker phone for vertical Matt the Miner episodes.
// The list comes from feed.json in the public gali-tv bucket, which the tv-admin function rewrites on every change.
// Two playlists, each in order from the first episode to the latest. A first visit starts at Matt the Miner
// episode 1; a return visit resumes at the first episode not yet finished. When an episode ends the next one plays.
// Sound starts on where the browser allows it; otherwise muted until the first tap or key press.
const FILES = 'https://rckvfpwtdyvvvjqqlffn.supabase.co/storage/v1/object/public/gali-tv/';

const CHANNELS = {
  cartoon: { num: '01', name: 'MATT', label: 'Matt the Miner', unit: 'episode', blurb: 'A pixel cartoon from Gali Island.', angle: -40 },
  team: { num: '02', name: 'TEAM', label: 'Team Updates', unit: 'video', blurb: 'News, devlogs and pitches from the Gali team.', angle: 40 },
};
const ORDER = ['cartoon', 'team'];
const UP_NEXT_S = 6;
const DONE = 0.9; // an episode counts as watched past 90%
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const el = {
  screen: $('screen'), video: $('video'), backdrop: $('backdrop'), stat: $('static'), testcard: $('testcard'),
  tcTitle: $('tc-title'), tcSub: $('tc-sub'), osdCh: $('osd-ch'), osdStatus: $('osd-status'),
  sound: $('sound'), bigPlay: $('big-play'), upnext: $('upnext'), unCount: $('un-count'), unTitle: $('un-title'),
  play: $('b-play'), mute: $('b-mute'), seek: $('seek'), seekFill: $('seek-fill'), seekHead: $('seek-head'), time: $('time'),
  dial: $('dial'), led: $('led'), channels: $('channels'), series: $('series'), eps: $('eps'),
  plMeta: $('pl-meta'), plTitle: $('pl-title'), plDesc: $('pl-desc'), plActions: $('pl-actions'),
  toast: $('toast'), tv: $('tv'),
};

// channel = the playlist on screen in the panel; the playing episode can belong to either
const state = { videos: [], channel: 'cartoon', current: null, on: true, volume: 0.8, latestId: null, autoplay: true };
let soundUnlocked = false;

/* ---------------- helpers ---------------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fileUrl = (p) => (!p ? '' : /^(https?:|\.\/)/.test(p) ? p : FILES + p.split('/').map(encodeURIComponent).join('/'));
const clock = (s) => {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
};
const day = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const isFresh = (iso) => Date.now() - new Date(iso).getTime() < 7 * 864e5;
const byId = (id) => state.videos.find((v) => v.id === id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/** A playlist in watching order: episodes by number, team videos by date, oldest first. */
function list(ch = state.channel) {
  const l = state.videos.filter((v) => v.series === ch);
  return ch === 'cartoon'
    ? l.sort((a, b) => (a.episode ?? 1e9) - (b.episode ?? 1e9) || a.created_at.localeCompare(b.created_at))
    : l.sort((a, b) => a.created_at.localeCompare(b.created_at));
}
const epLabel = (v, i) => (v.series === 'cartoon' ? `Episode ${v.episode ?? i + 1}` : day(v.created_at));

const watched = (() => {
  let m = {};
  try { m = JSON.parse(store.get('galitv:watched') || '{}'); } catch { /* corrupt */ }
  return {
    get: (id) => m[id] || 0,
    set(id, f) {
      m[id] = Math.max(m[id] || 0, Math.min(1, f));
      store.set('galitv:watched', JSON.stringify(m));
    },
  };
})();

/** Where a playlist picks up: the first episode not finished yet, or the first one again once all are watched. */
function resumeIn(ch) {
  const l = list(ch);
  return l.find((v) => watched.get(v.id) < DONE) || l[0] || null;
}
/** What plays after `v`: the next episode, and after the last Matt the Miner episode, the team updates. */
function nextAfter(v) {
  if (!v) return null;
  const l = list(v.series);
  const i = l.findIndex((x) => x.id === v.id);
  if (i >= 0 && i < l.length - 1) return l[i + 1];
  return v.series === 'cartoon' ? resumeIn('team') : null;
}
function prevBefore(v) {
  if (!v) return null;
  const l = list(v.series);
  const i = l.findIndex((x) => x.id === v.id);
  return i > 0 ? l[i - 1] : null;
}

let toastT;
function toast(msg) {
  el.toast.textContent = msg;
  el.toast.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.toast.classList.remove('on'), 2200);
}

let osdT = {};
function osd(node, text, ms = 1800) {
  node.textContent = text;
  node.classList.add('on');
  clearTimeout(osdT[node.id]);
  if (ms) osdT[node.id] = setTimeout(() => node.classList.remove('on'), ms);
}

/* ---------------- static noise + night sky ---------------- */
const sctx = el.stat.getContext('2d');
const noise = sctx.createImageData(160, 90);
let staticOn = false;
function drawStatic() {
  if (!staticOn) return;
  const d = noise.data;
  for (let i = 0; i < d.length; i += 4) {
    const v = (Math.random() * 255) | 0;
    d[i] = d[i + 1] = d[i + 2] = v;
    d[i + 3] = 255;
  }
  sctx.putImageData(noise, 0, 0);
  requestAnimationFrame(drawStatic);
}
function zap(ms = 420) {
  if (reduceMotion) return Promise.resolve();
  staticOn = true;
  el.screen.classList.add('switching');
  drawStatic();
  return new Promise((r) => setTimeout(() => { staticOn = false; el.screen.classList.remove('switching'); r(); }, ms));
}

(function sky() {
  const c = $('stars'), x = c.getContext('2d');
  let stars = [];
  const size = () => {
    c.width = Math.ceil(innerWidth / 4);
    c.height = Math.ceil(innerHeight / 4);
    stars = Array.from({ length: Math.round((c.width * c.height) / 260) }, () => ({
      x: (Math.random() * c.width) | 0, y: (Math.random() * c.height * 0.8) | 0, p: Math.random() * 6.28, b: Math.random() < 0.12,
    }));
  };
  const draw = (t) => {
    x.clearRect(0, 0, c.width, c.height);
    for (const s of stars) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(s.p + t / 1400));
      x.fillStyle = s.b ? `rgba(255,200,61,${a})` : `rgba(255,243,220,${a * 0.8})`;
      x.fillRect(s.x, s.y, 1, 1);
    }
  };
  size();
  addEventListener('resize', size);
  if (reduceMotion) return draw(0);
  let last = 0;
  const loop = (t) => { if (t - last > 120) { draw(t); last = t; } requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
})();

/* ---------------- data ---------------- */
const DEMO = [
  { id: 'demo-3', series: 'cartoon', title: 'The Motherlode', description: 'Demo tape. Real episodes arrive from the admin page.', episode: 3, video_path: './demo/matt.mp4', width: 1080, height: 1920, duration_s: 43.7, created_at: new Date().toISOString() },
  { id: 'demo-2', series: 'team', title: 'Devlog: the island goes live', description: 'Demo tape from the team channel.', episode: null, video_path: 'https://gali.lol/game/lobby.mp4', duration_s: 9, created_at: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'demo-1', series: 'cartoon', title: 'First Dig', description: 'Matt picks up his first pickaxe.', episode: 2, video_path: './demo/matt.mp4', width: 1080, height: 1920, duration_s: 43.7, created_at: new Date(Date.now() - 9 * 864e5).toISOString() },
  { id: 'demo-0', series: 'cartoon', title: 'Welcome to Gali Island', description: '', episode: 1, video_path: './demo/matt.mp4', width: 1080, height: 1920, duration_s: 43.7, created_at: new Date(Date.now() - 20 * 864e5).toISOString() },
];

async function fetchVideos() {
  if (new URLSearchParams(location.search).has('demo')) return DEMO;
  // the CDN keeps feed.json for 15 s; the query string makes a fresh copy at most that old
  const r = await fetch(`${FILES}feed.json?t=${Math.floor(Date.now() / 15000)}`);
  if (r.status === 400 || r.status === 404) return []; // nothing published yet
  if (!r.ok) throw new Error(`feed ${r.status}`);
  return (await r.json()).videos ?? [];
}

/* ---------------- rendering ---------------- */
function setScreenState(s, title, sub) {
  el.screen.dataset.state = s;
  if (title) el.tcTitle.textContent = title;
  if (sub !== undefined) el.tcSub.textContent = sub;
}

/** The dial on the TV shows the channel that's playing. */
function renderDial(ch) {
  for (const m of document.querySelectorAll('.dial-marks b')) m.classList.toggle('on', m.dataset.ch === ch);
  el.dial.style.transform = `rotate(${CHANNELS[ch].angle}deg)`;
}

function renderTabs() {
  for (const b of el.channels.querySelectorAll('[role=tab]')) {
    const on = b.dataset.ch === state.channel;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
}

function renderSeries() {
  const ch = CHANNELS[state.channel];
  const l = list();
  if (!l.length) {
    el.series.innerHTML = `<h2>${ch.label}</h2><p class="se-blurb">${ch.blurb}</p><p class="se-meta">Nothing here yet. Check back soon.</p>`;
    return;
  }
  const total = l.reduce((s, v) => s + Number(v.duration_s || 0), 0);
  const seen = l.filter((v) => watched.get(v.id) >= DONE).length;
  const go = resumeIn(state.channel);
  const i = l.indexOf(go);
  const verb = seen === 0 ? 'Play' : seen === l.length ? 'Watch again:' : 'Resume';
  const what = state.channel === 'cartoon' ? `Ep ${go.episode ?? i + 1}` : seen === 0 ? 'from the first' : go.title;
  const playingHere = state.current?.series === state.channel;
  el.series.innerHTML = `
    <h2>${ch.label}</h2>
    <p class="se-blurb">${ch.blurb}</p>
    <p class="se-meta">${l.length} ${ch.unit}${l.length === 1 ? '' : 's'}${total ? ` · ${Math.max(1, Math.round(total / 60))} min` : ''}${seen ? ` · ${seen} watched` : ''}</p>
    <div class="se-actions">
      ${playingHere ? '' : `<button class="btn gold" data-act="resume"><span>▶ ${verb} ${esc(what.length > 26 ? `${what.slice(0, 25)}…` : what)}</span></button>`}
      <label class="autoplay"><input type="checkbox" id="autoplay" ${state.autoplay ? 'checked' : ''}><i aria-hidden="true"></i>Autoplay next</label>
    </div>`;
  $('autoplay').addEventListener('change', (e) => {
    state.autoplay = e.target.checked;
    store.set('galitv:autoplay', state.autoplay ? '1' : '0');
  });
}

function epHtml(v, i) {
  const poster = fileUrl(v.poster_path);
  const w = watched.get(v.id);
  const dur = v.duration_s ? clock(Number(v.duration_s)) : '';
  return `<li class="ep${w >= DONE ? ' seen' : ''}" data-id="${esc(v.id)}">
    <button aria-label="Play ${esc(epLabel(v, i))}: ${esc(v.title)}">
      <span class="ep-num" aria-hidden="true"><b>${v.series === 'cartoon' ? v.episode ?? i + 1 : i + 1}</b><span class="eq"><i></i><i></i><i></i></span></span>
      <span class="ep-thumb${v.height > v.width ? ' tall' : ''}" ${poster ? `style="background-image:url('${esc(poster)}')"` : ''}>
        ${poster ? '' : `<video muted playsinline preload="metadata" tabindex="-1" aria-hidden="true" src="${esc(fileUrl(v.video_path))}#t=1.5"></video>`}
        ${dur ? `<span class="dur">${dur}</span>` : ''}
        <span class="prog"><b style="width:${Math.round(w * 100)}%"></b></span>
        <span class="play-ico" aria-hidden="true">▶</span>
      </span>
      <span class="ep-txt">
        <span class="ep-top">${esc(epLabel(v, i))}${v.id === state.latestId && isFresh(v.created_at) ? '<em class="new">NEW</em>' : ''}${w >= DONE ? '<em class="done">✓ WATCHED</em>' : ''}</span>
        <b class="ep-title">${esc(v.title)}</b>
        ${v.description ? `<span class="ep-desc">${esc(v.description)}</span>` : ''}
      </span>
    </button>
  </li>`;
}

function renderPlaylist() {
  renderTabs();
  renderSeries();
  const l = list();
  el.eps.innerHTML = l.map(epHtml).join('');
  markPlaying();
}

function markPlaying() {
  for (const t of el.eps.querySelectorAll('.ep')) {
    const on = t.dataset.id === state.current?.id;
    t.classList.toggle('playing', on);
    t.querySelector('button')?.setAttribute('aria-current', on ? 'true' : 'false');
  }
}

/** Bring the playing episode into view inside the list, without scrolling the page. */
function scrollToPlaying() {
  const t = el.eps.querySelector('.ep.playing');
  if (!t || el.eps.scrollHeight <= el.eps.clientHeight) return;
  const top = t.offsetTop - el.eps.offsetTop - el.eps.clientHeight / 2 + t.clientHeight / 2;
  el.eps.scrollTo({ top, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function renderPlaque(v) {
  if (!v) {
    el.plMeta.innerHTML = '<span class="chip">OFF AIR</span>';
    el.plTitle.textContent = state.videos.length ? 'Pick an episode' : 'Nothing on Gali TV yet';
    el.plDesc.textContent = state.videos.length ? '' : 'New episodes and updates land here first. Follow along on TikTok in the meantime.';
    el.plActions.innerHTML = `<a class="btn cyan" href="https://www.tiktok.com/@gali_world" target="_blank" rel="noopener"><span>Follow @gali_world</span></a>`;
    return;
  }
  const l = list(v.series);
  const i = l.findIndex((x) => x.id === v.id);
  const chip = v.series === 'cartoon' ? '<span class="chip cartoon">CH 01 · MATT THE MINER</span>' : '<span class="chip team">CH 02 · TEAM UPDATES</span>';
  const ep = `<span class="chip">${v.series === 'cartoon' ? `EPISODE ${v.episode ?? i + 1} OF ${l.length}` : `${i + 1} OF ${l.length}`}</span>`;
  const fresh = v.id === state.latestId && isFresh(v.created_at) ? '<span class="chip new">NEW</span>' : '';
  el.plMeta.innerHTML = `${chip}${ep}${fresh}<span>${day(v.created_at)}${v.duration_s ? ` · ${clock(Number(v.duration_s))}` : ''}</span>`;
  el.plTitle.textContent = v.title;
  el.plDesc.textContent = v.description || '';
  const next = nextAfter(v);
  el.plActions.innerHTML = [
    next ? `<button class="btn gold" data-act="next"><span>Next: ${esc(next.title.length > 28 ? `${next.title.slice(0, 27)}…` : next.title)} ▶</span></button>` : '',
    v.tiktok_url ? `<a class="btn cyan" href="${esc(v.tiktok_url)}" target="_blank" rel="noopener"><span>Watch on TikTok</span></a>` : '',
    '<button class="btn light" data-act="share"><span>Share</span></button>',
  ].join('');
}

/* ---------------- device: TV for team updates, Seeker phone for Matt the Miner ---------------- */
const setEl = $('set');
function deviceFor(v) {
  if (!v) return state.channel === 'cartoon' ? 'phone' : 'tv';
  if (v.width && v.height) return v.height > v.width ? 'phone' : 'tv';
  return v.series === 'cartoon' ? 'phone' : 'tv';
}
function setDevice(device) {
  const want = device === 'phone';
  if (setEl.classList.contains('phone') === want) return Promise.resolve();
  const apply = () => {
    setEl.classList.toggle('phone', want);
    el.tv.setAttribute('aria-label', want ? 'Gali TV player, Seeker phone view' : 'Gali TV player');
  };
  if (reduceMotion || !document.startViewTransition) { apply(); return Promise.resolve(); }
  return document.startViewTransition(apply).finished.catch(() => {});
}

/* ---------------- playback ---------------- */
async function tune(v, { autoplay = true, quiet = false } = {}) {
  hideUpNext();
  if (!v) {
    state.current = null;
    void setDevice(deviceFor(null));
    el.video.removeAttribute('src');
    el.video.load();
    setScreenState('empty', 'OFF AIR', `${CHANNELS[state.channel].label}: first broadcast soon`);
    el.backdrop.style.backgroundImage = '';
    renderPlaque(null);
    renderPlaylist();
    syncPlayUi();
    return;
  }
  const morph = setDevice(deviceFor(v));
  const zapping = quiet ? null : zap();
  state.current = v;
  // the panel follows the episode that's playing, so autoplay into the team updates shows that list
  state.channel = v.series;
  renderDial(v.series);
  const ch = CHANNELS[v.series];
  osd(el.osdCh, `CH ${ch.num} ${ch.name}`, 2600);
  const poster = fileUrl(v.poster_path);
  el.backdrop.style.backgroundImage = poster ? `url("${poster}")` : `radial-gradient(circle at 50% 40%, ${v.series === 'team' ? '#1d5f57' : '#6b4a12'}, #120c16)`;
  el.video.poster = poster || '';
  el.video.src = fileUrl(v.video_path);
  el.video.volume = state.volume;
  setScreenState('live');
  renderPlaque(v);
  renderPlaylist();
  scrollToPlaying();
  const u = new URL(location.href);
  u.searchParams.set('v', v.id);
  history.replaceState(null, '', u);
  document.title = `${v.title} · Gali TV`;
  await Promise.all([zapping, morph]);
  if (autoplay && state.on) await start();
}

async function start() {
  try {
    await el.video.play();
    el.bigPlay.hidden = true;
  } catch {
    // autoplay with sound is blocked: retry muted, and if even that fails, ask for a tap
    if (!el.video.muted) {
      el.video.muted = true;
      return start();
    }
    el.bigPlay.hidden = false;
  }
  syncPlayUi();
}

function togglePlay() {
  if (!state.current || !state.on) return;
  if (el.video.paused) { void start(); osd(el.osdStatus, '▶ PLAY'); } else { el.video.pause(); osd(el.osdStatus, '❚❚ PAUSE', 0); }
}

function unlockSound() {
  soundUnlocked = true;
  el.video.muted = false;
  el.video.volume = state.volume;
  syncPlayUi();
}

// Browsers only allow sound after a tap, click or key press, so a muted autoplay gets its sound on the first one
// anywhere on the page. Controls that set sound themselves (mute, the sticker, M) are left to do that.
let soundUnlockedAt = 0;
function firstGesture(e) {
  if (soundUnlocked || !el.video.muted) return dropFirstGesture();
  if (e.type === 'keydown' && (e.key === 'm' || e.key === 'M' || e.metaKey || e.ctrlKey || e.altKey)) return;
  if (e.target.closest?.('#b-mute, #sound, #big-play')) return;
  soundUnlockedAt = performance.now();
  unlockSound();
  dropFirstGesture();
}
const GESTURES = ['pointerdown', 'keydown'];
const dropFirstGesture = () => GESTURES.forEach((t) => removeEventListener(t, firstGesture, true));
GESTURES.forEach((t) => addEventListener(t, firstGesture, true));

function syncPlayUi() {
  const playing = !el.video.paused && !el.video.ended;
  el.play.textContent = playing ? '❚❚' : '▶';
  el.play.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  document.body.classList.toggle('paused-all', !playing);
  if (playing) el.osdStatus.classList.remove('on');
  el.mute.textContent = el.video.muted ? '🔇' : state.volume > 0.5 ? '🔊' : '🔉';
  el.mute.setAttribute('aria-label', el.video.muted ? 'Unmute' : 'Mute');
  el.sound.hidden = !(state.current && el.video.muted && !soundUnlocked && state.on);
  el.led.classList.toggle('on', state.on);
}

function setVolume(delta) {
  state.volume = Math.max(0, Math.min(1, Math.round((state.volume + delta) * 10) / 10));
  el.video.volume = state.volume;
  if (state.volume > 0 && el.video.muted) unlockSound();
  const bars = Math.round(state.volume * 10);
  osd(el.osdStatus, `VOL ${'▮'.repeat(bars)}${'▯'.repeat(10 - bars)}`);
  syncPlayUi();
}

function step(dir) {
  const v = dir > 0 ? nextAfter(state.current) : prevBefore(state.current);
  if (v) void tune(v);
  else toast(dir > 0 ? 'That was the latest episode' : 'This is the first episode');
}

/** Tabs and the playlist panel: look at a playlist without changing what's playing. */
function showPlaylist(ch) {
  if (!CHANNELS[ch]) return;
  state.channel = ch;
  renderPlaylist();
  scrollToPlaying();
}

/** The TV's dial and the ↑/↓ keys change channel like a TV: tune to where that playlist picks up. */
function changeChannel(dir) {
  const from = state.current?.series ?? state.channel;
  const ch = ORDER[(ORDER.indexOf(from) + dir + ORDER.length) % ORDER.length];
  state.channel = ch;
  const v = resumeIn(ch);
  if (v) void tune(v);
  else { renderDial(ch); osd(el.osdCh, `CH ${CHANNELS[ch].num} ${CHANNELS[ch].name}`, 2600); void tune(null); }
}

/* up next */
let unTimer = null;
function showUpNext() {
  const next = nextAfter(state.current);
  if (!next) { osd(el.osdStatus, '■ ALL CAUGHT UP', 0); return; }
  const crossing = next.series !== state.current.series;
  el.unTitle.textContent = `${crossing ? `${CHANNELS[next.series].label}: ` : ''}${next.title}`;
  el.upnext.hidden = false;
  if (!state.autoplay) { el.unCount.parentElement.firstChild.textContent = 'UP NEXT'; el.unCount.textContent = ''; return; }
  let n = UP_NEXT_S;
  el.unCount.parentElement.firstChild.textContent = 'UP NEXT IN ';
  el.unCount.textContent = String(n);
  unTimer = setInterval(() => {
    n -= 1;
    el.unCount.textContent = String(n);
    if (n <= 0) { hideUpNext(); void tune(next); }
  }, 1000);
}
function hideUpNext() {
  clearInterval(unTimer);
  unTimer = null;
  el.upnext.hidden = true;
}

/* power-on flash when the page opens */
function powerOnFx() {
  if (reduceMotion) return;
  el.screen.classList.remove('powering');
  void el.screen.offsetWidth;
  el.screen.classList.add('powering');
  setTimeout(() => el.screen.classList.remove('powering'), 750);
}

/* seek */
function seekTo(clientX) {
  const r = el.seek.getBoundingClientRect();
  const f = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  if (Number.isFinite(el.video.duration)) el.video.currentTime = f * el.video.duration;
}
function paintProgress() {
  const d = el.video.duration, t = el.video.currentTime;
  const f = Number.isFinite(d) && d > 0 ? t / d : 0;
  el.seekFill.style.width = `calc(${f * 100}% - 4px)`;
  el.seekHead.style.left = `${f * 100}%`;
  el.seek.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  el.seek.setAttribute('aria-valuetext', `${clock(t)} of ${clock(d)}`);
  el.time.textContent = `${clock(t)} / ${clock(d)}`;
  // the playing row's progress bar follows along
  const bar = state.current && el.eps.querySelector(`.ep.playing .prog b`);
  if (bar) bar.style.width = `${Math.round(Math.max(f, watched.get(state.current.id)) * 100)}%`;
}

/* share */
async function share() {
  const v = state.current;
  if (!v) return;
  const url = new URL(location.href);
  url.search = `?v=${v.id}`;
  try {
    if (navigator.share && matchMedia('(pointer:coarse)').matches) await navigator.share({ title: `${v.title} · Gali TV`, url: url.href });
    else { await navigator.clipboard.writeText(url.href); toast('Link copied. Paste it anywhere.'); }
  } catch { /* cancelled */ }
}

/* ---------------- events ---------------- */
el.video.addEventListener('play', syncPlayUi);
el.video.addEventListener('pause', syncPlayUi);
el.video.addEventListener('volumechange', syncPlayUi);
el.video.addEventListener('loadedmetadata', paintProgress);
let lastSave = 0;
el.video.addEventListener('timeupdate', () => {
  paintProgress();
  const now = Date.now();
  if (state.current && now - lastSave > 3000 && el.video.duration) {
    lastSave = now;
    watched.set(state.current.id, el.video.currentTime / el.video.duration);
  }
});
el.video.addEventListener('ended', () => {
  if (state.current) watched.set(state.current.id, 1);
  syncPlayUi();
  renderPlaylist();
  showUpNext();
});
el.video.addEventListener('error', () => {
  if (!state.current) return;
  setScreenState('error', 'NO SIGNAL', 'This episode will not play. Try another.');
});

el.screen.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  // the tap that just turned the sound on shouldn't also pause the video
  if (performance.now() - soundUnlockedAt < 800) return;
  if (el.video.muted && !soundUnlocked && !el.video.paused) return unlockSound();
  togglePlay();
});
el.screen.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) fullscreen(); });
el.sound.addEventListener('click', unlockSound);
el.bigPlay.addEventListener('click', () => { unlockSound(); void start(); });
$('un-play').addEventListener('click', () => { const n = nextAfter(state.current); hideUpNext(); if (n) void tune(n); });
$('un-cancel').addEventListener('click', hideUpNext);

el.play.addEventListener('click', togglePlay);
$('b-prev').addEventListener('click', () => step(-1));
$('b-next').addEventListener('click', () => step(1));
el.mute.addEventListener('click', () => { if (el.video.muted) unlockSound(); else { el.video.muted = true; soundUnlocked = true; syncPlayUi(); } });
$('b-full').addEventListener('click', fullscreen);
function fullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else if (el.tv.requestFullscreen) void el.tv.requestFullscreen().catch(() => {});
  else if (el.video.webkitEnterFullscreen) el.video.webkitEnterFullscreen();
}

let dragging = false;
el.seek.addEventListener('pointerdown', (e) => { dragging = true; el.seek.setPointerCapture(e.pointerId); seekTo(e.clientX); });
el.seek.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
el.seek.addEventListener('pointerup', () => { dragging = false; });
el.seek.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    e.stopPropagation();
    el.video.currentTime = Math.max(0, el.video.currentTime + (e.key === 'ArrowRight' ? 5 : -5));
  }
});

el.dial.addEventListener('click', () => changeChannel(1));
el.channels.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) showPlaylist(b.dataset.ch); });
el.channels.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  e.stopPropagation();
  const i = ORDER.indexOf(state.channel);
  showPlaylist(ORDER[(i + (e.key === 'ArrowRight' ? 1 : -1) + ORDER.length) % ORDER.length]);
  el.channels.querySelector('[aria-selected=true]')?.focus();
});
el.series.addEventListener('click', (e) => {
  if (e.target.closest('[data-act=resume]')) { unlockSound(); void tune(resumeIn(state.channel)); }
});
el.eps.addEventListener('click', (e) => {
  const t = e.target.closest('.ep');
  if (!t) return;
  const v = byId(t.dataset.id);
  if (v?.id === state.current?.id) togglePlay();
  else if (v) { void tune(v); unlockSound(); }
});
el.plActions.addEventListener('click', (e) => {
  const a = e.target.closest('[data-act]')?.dataset.act;
  if (a === 'share') void share();
  if (a === 'next') step(1);
});

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input,textarea,select,[contenteditable]') || e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (k === ' ' || k === 'k') { if (e.target.closest?.('button,a')) return; e.preventDefault(); unlockSound(); togglePlay(); }
  else if (k === 'ArrowRight') { e.preventDefault(); step(1); }
  else if (k === 'ArrowLeft') { e.preventDefault(); step(-1); }
  else if (k === 'ArrowUp') { e.preventDefault(); changeChannel(-1); }
  else if (k === 'ArrowDown') { e.preventDefault(); changeChannel(1); }
  else if (k === 'm' || k === 'M') { el.mute.click(); }
  else if (k === 'f' || k === 'F') { fullscreen(); }
  else if (k === '+' || k === '=') { setVolume(0.1); }
  else if (k === '-') { setVolume(-0.1); }
  else if (/^[1-9]$/.test(k)) {
    const v = list()[Number(k) - 1];
    if (v) { unlockSound(); void tune(v); } else toast(`No episode ${k} in ${CHANNELS[state.channel].label}`);
  }
});

/* ---------------- boot ---------------- */
(async function boot() {
  state.autoplay = store.get('galitv:autoplay') !== '0';
  renderDial('cartoon');
  renderTabs();
  setScreenState('boot', 'STAND BY', 'Tuning in…');
  powerOnFx();
  try {
    state.videos = await fetchVideos();
  } catch {
    setScreenState('error', 'STAND BY', 'The broadcast tower is warming up. Try again in a minute.');
    el.plTitle.textContent = 'Gali TV is warming up';
    el.plDesc.textContent = 'We could not reach the broadcast. Refresh in a moment.';
    el.plMeta.innerHTML = '<span class="chip">NO SIGNAL</span>';
    renderPlaylist();
    syncPlayUi();
    return;
  }
  // the newest upload of all gets the NEW tag
  state.latestId = [...state.videos].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]?.id ?? null;
  // a shared link plays that episode; otherwise Matt the Miner from episode 1, or where this viewer left off
  const want = new URLSearchParams(location.search).get('v');
  const first = (want && byId(want)) || resumeIn('cartoon') || resumeIn('team');
  if (!first) {
    renderPlaylist();
    setScreenState('empty', 'OFF AIR', 'First broadcast soon');
    renderPlaque(null);
    syncPlayUi();
    return;
  }
  // try with sound; start() falls back to muted when the browser blocks it
  await tune(first, { quiet: true });
})();
