// Gali TV: plays the published videos on a pixel CRT, or on a Seeker phone for vertical Matt the Miner episodes.
// The list comes from feed.json in the public gali-tv bucket, which the tv-admin function rewrites on every change.
// The newest upload autoplays (muted, as browsers require) until someone taps for sound.
const FILES = 'https://rckvfpwtdyvvvjqqlffn.supabase.co/storage/v1/object/public/gali-tv/';

const CHANNELS = {
  all: { num: '00', name: 'ALL', label: 'Everything', angle: 0 },
  cartoon: { num: '01', name: 'MATT', label: 'Matt the Miner', angle: 120 },
  team: { num: '02', name: 'TEAM', label: 'Team Updates', angle: 240 },
};
const ORDER = ['all', 'cartoon', 'team'];
const UP_NEXT_S = 6;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const $ = (id) => document.getElementById(id);
const el = {
  screen: $('screen'), video: $('video'), backdrop: $('backdrop'), stat: $('static'), testcard: $('testcard'),
  tcTitle: $('tc-title'), tcSub: $('tc-sub'), osdCh: $('osd-ch'), osdStatus: $('osd-status'),
  sound: $('sound'), bigPlay: $('big-play'), upnext: $('upnext'), unCount: $('un-count'), unTitle: $('un-title'),
  play: $('b-play'), mute: $('b-mute'), seek: $('seek'), seekFill: $('seek-fill'), seekHead: $('seek-head'), time: $('time'),
  dial: $('dial'), led: $('led'), channels: $('channels'), shelf: $('shelf'),
  plMeta: $('pl-meta'), plTitle: $('pl-title'), plDesc: $('pl-desc'), plActions: $('pl-actions'),
  toast: $('toast'), tv: $('tv'),
};

const state = { videos: [], channel: 'all', current: null, on: true, volume: 0.8, latestId: null };
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
const list = (ch = state.channel) => (ch === 'all' ? state.videos : state.videos.filter((v) => v.series === ch));
const byId = (id) => state.videos.find((v) => v.id === id);

const watched = (() => {
  let m = {};
  try { m = JSON.parse(localStorage.getItem('galitv:watched') || '{}'); } catch { /* private mode */ }
  return {
    get: (id) => m[id] || 0,
    set(id, f) {
      m[id] = Math.max(m[id] || 0, Math.min(1, f));
      try { localStorage.setItem('galitv:watched', JSON.stringify(m)); } catch { /* ignore */ }
    },
  };
})();

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
  { id: 'demo-3', series: 'cartoon', title: 'The Motherlode', description: 'Demo tape. Real episodes arrive from the admin page.', episode: 3, video_path: './demo/matt.mp4', width: 1080, height: 1920, created_at: new Date().toISOString() },
  { id: 'demo-2', series: 'team', title: 'Devlog: the island goes live', description: 'Demo tape from the team channel.', episode: null, video_path: 'https://gali.lol/game/lobby.mp4', created_at: new Date(Date.now() - 3 * 864e5).toISOString() },
  { id: 'demo-1', series: 'cartoon', title: 'First Dig', description: '', episode: 2, video_path: './demo/matt.mp4', width: 1080, height: 1920, created_at: new Date(Date.now() - 9 * 864e5).toISOString() },
  { id: 'demo-0', series: 'cartoon', title: 'Welcome to Gali Island', description: '', episode: 1, video_path: './demo/matt.mp4', width: 1080, height: 1920, created_at: new Date(Date.now() - 20 * 864e5).toISOString() },
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

function renderChannels() {
  for (const b of el.channels.querySelectorAll('[role=tab]')) {
    const on = b.dataset.ch === state.channel;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const m of document.querySelectorAll('.dial-marks b')) m.classList.toggle('on', m.dataset.ch === state.channel);
  // keep turning the same way so the knob never spins backwards through 0
  const target = CHANNELS[state.channel].angle;
  const now = Number(el.dial.dataset.angle || 0);
  let next = now + ((((target - now) % 360) + 360) % 360);
  if (next === now && el.dial.dataset.angle) next = now;
  el.dial.dataset.angle = String(next);
  el.dial.style.transform = `rotate(${next}deg)`;
}

function tapeHtml(v, i) {
  const ch = CHANNELS[v.series];
  const poster = fileUrl(v.poster_path);
  const w = watched.get(v.id);
  const tag = v.series === 'cartoon' ? (v.episode != null ? `EP ${String(v.episode).padStart(2, '0')}` : 'MATT') : 'TEAM';
  return `<li class="tape" data-id="${esc(v.id)}" data-series="${v.series}">
    <button aria-label="Play ${esc(v.title)}" data-n="${i + 1}">
      ${v.id === state.latestId ? '<span class="sticker">NEW!</span>' : ''}
      <div class="case">
        <div class="label">
          <div class="lbl-top"><span>CH ${ch.num} · ${tag}</span><span>${String(i + 1).padStart(2, '0')}</span></div>
          <div class="lbl-title">${esc(v.title)}</div>
        </div>
        <div class="window" ${poster ? `style="background-image:url('${esc(poster)}')"` : ''}>
          ${poster ? '' : `<div class="noposter">${v.series === 'cartoon' ? '▶' : '★'}</div><video muted playsinline preload="metadata" tabindex="-1" aria-hidden="true" src="${esc(fileUrl(v.video_path))}#t=1.5"></video>`}
          ${v.duration_s ? `<span class="dur">${clock(Number(v.duration_s))}</span>` : ''}
          <div class="eq"><i></i><i></i><i></i></div>
          ${w > 0.02 ? `<div class="watched"><b style="width:${Math.round(w * 100)}%"></b></div>` : ''}
        </div>
        <div class="reels"><i></i><i></i></div>
      </div>
    </button>
  </li>`;
}

function renderShelf() {
  const items = list();
  el.shelf.innerHTML = items.length
    ? items.map(tapeHtml).join('')
    : `<li class="shelf-empty">No tapes on ${CHANNELS[state.channel].label} yet.<br>Check back soon.</li>`;
  markPlaying();
  updateShelfNav();
}

function markPlaying() {
  for (const t of el.shelf.querySelectorAll('.tape')) {
    const on = t.dataset.id === state.current?.id;
    t.classList.toggle('playing', on);
    t.querySelector('button')?.setAttribute('aria-current', on ? 'true' : 'false');
  }
}

function scrollToPlaying() {
  const t = el.shelf.querySelector('.tape.playing');
  if (!t) return;
  const left = t.offsetLeft - el.shelf.clientWidth / 2 + t.clientWidth / 2;
  el.shelf.scrollTo({ left, behavior: reduceMotion ? 'auto' : 'smooth' });
}

function updateShelfNav() {
  const s = el.shelf;
  $('shelf-l').disabled = s.scrollLeft < 8;
  $('shelf-r').disabled = s.scrollLeft + s.clientWidth > s.scrollWidth - 8;
}

function renderPlaque(v) {
  if (!v) {
    el.plMeta.innerHTML = '<span class="chip">OFF AIR</span>';
    el.plTitle.textContent = list().length ? 'Pick a tape below' : 'Nothing on this channel yet';
    el.plDesc.textContent = list().length ? '' : 'New episodes and updates land here first. Follow along on TikTok in the meantime.';
    el.plActions.innerHTML = `<a class="btn cyan" href="https://www.tiktok.com/@gali_world" target="_blank" rel="noopener"><span>Follow @gali_world</span></a>`;
    return;
  }
  const chip = v.series === 'cartoon' ? '<span class="chip cartoon">CH 01 · MATT THE MINER</span>' : '<span class="chip team">CH 02 · TEAM UPDATE</span>';
  const ep = v.series === 'cartoon' && v.episode != null ? `<span class="chip">EPISODE ${v.episode}</span>` : '';
  const fresh = v.id === state.latestId && isFresh(v.created_at) ? '<span class="chip new">NEW</span>' : '';
  el.plMeta.innerHTML = `${chip}${ep}${fresh}<span>${day(v.created_at)}${v.duration_s ? ` · ${clock(Number(v.duration_s))}` : ''}</span>`;
  el.plTitle.textContent = v.title;
  el.plDesc.textContent = v.description || '';
  const next = neighbour(1);
  el.plActions.innerHTML = [
    v.tiktok_url ? `<a class="btn cyan" href="${esc(v.tiktok_url)}" target="_blank" rel="noopener"><span>Watch on TikTok</span></a>` : '',
    '<button class="btn light" data-act="share"><span>Share this tape</span></button>',
    next ? `<button class="btn" data-act="next"><span>Next: ${esc(next.title.length > 28 ? `${next.title.slice(0, 27)}…` : next.title)} ▶</span></button>` : '',
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
function neighbour(dir) {
  const l = list();
  if (!l.length) return null;
  const i = l.findIndex((v) => v.id === state.current?.id);
  if (i < 0) return l[0];
  const j = i + dir;
  return j >= 0 && j < l.length ? l[j] : null;
}

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
    markPlaying();
    syncPlayUi();
    return;
  }
  const morph = setDevice(deviceFor(v));
  const zapping = quiet ? null : zap();
  state.current = v;
  const ch = CHANNELS[v.series];
  osd(el.osdCh, `CH ${ch.num} ${ch.name}`, 2600);
  const poster = fileUrl(v.poster_path);
  el.backdrop.style.backgroundImage = poster ? `url("${poster}")` : `radial-gradient(circle at 50% 40%, ${v.series === 'team' ? '#1d5f57' : '#6b4a12'}, #120c16)`;
  el.video.poster = poster || '';
  el.video.src = fileUrl(v.video_path);
  el.video.volume = state.volume;
  setScreenState('live');
  renderPlaque(v);
  markPlaying();
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
  const v = neighbour(dir);
  if (v) void tune(v);
  else toast(dir > 0 ? 'That was the last tape on this channel' : 'Already at the newest tape');
}

function setChannel(ch, { play = true } = {}) {
  if (!CHANNELS[ch]) return;
  state.channel = ch;
  renderChannels();
  renderShelf();
  if (!play) return;
  const l = list();
  // stay on the current tape when it belongs to the new channel, otherwise tune to its newest
  if (state.current && l.some((v) => v.id === state.current.id)) {
    osd(el.osdCh, `CH ${CHANNELS[ch].num} ${CHANNELS[ch].name}`, 2600);
    markPlaying();
    scrollToPlaying();
    renderPlaque(state.current);
  } else void tune(l[0] || null);
}

function cycleChannel(dir) {
  const i = ORDER.indexOf(state.channel);
  setChannel(ORDER[(i + dir + ORDER.length) % ORDER.length]);
}

/* up next */
let unTimer = null;
function showUpNext() {
  const next = neighbour(1);
  if (!next) { osd(el.osdStatus, '■ END OF TAPE', 0); return; }
  let n = UP_NEXT_S;
  el.unTitle.textContent = next.title;
  el.unCount.textContent = String(n);
  el.upnext.hidden = false;
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
  showUpNext();
});
el.video.addEventListener('error', () => {
  if (!state.current) return;
  setScreenState('error', 'NO SIGNAL', 'This tape will not play. Try another.');
});

el.screen.addEventListener('click', (e) => {
  if (e.target.closest('button')) return;
  if (el.video.muted && !soundUnlocked && !el.video.paused) return unlockSound();
  togglePlay();
});
el.screen.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) fullscreen(); });
el.sound.addEventListener('click', unlockSound);
el.bigPlay.addEventListener('click', () => { unlockSound(); void start(); });
$('un-play').addEventListener('click', () => { const n = neighbour(1); hideUpNext(); if (n) void tune(n); });
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

el.dial.addEventListener('click', () => cycleChannel(1));
el.channels.addEventListener('click', (e) => { const b = e.target.closest('[role=tab]'); if (b) setChannel(b.dataset.ch); });
el.channels.addEventListener('keydown', (e) => {
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  e.stopPropagation();
  cycleChannel(e.key === 'ArrowRight' ? 1 : -1);
  el.channels.querySelector('[aria-selected=true]')?.focus();
});
el.shelf.addEventListener('click', (e) => {
  const t = e.target.closest('.tape');
  if (!t) return;
  const v = byId(t.dataset.id);
  if (v?.id === state.current?.id) togglePlay();
  else if (v) { soundUnlocked = soundUnlocked || false; void tune(v); unlockSound(); }
});
el.shelf.addEventListener('scroll', updateShelfNav, { passive: true });
$('shelf-l').addEventListener('click', () => el.shelf.scrollBy({ left: -el.shelf.clientWidth * 0.8, behavior: 'smooth' }));
$('shelf-r').addEventListener('click', () => el.shelf.scrollBy({ left: el.shelf.clientWidth * 0.8, behavior: 'smooth' }));
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
  else if (k === 'ArrowUp') { e.preventDefault(); cycleChannel(-1); }
  else if (k === 'ArrowDown') { e.preventDefault(); cycleChannel(1); }
  else if (k === 'm' || k === 'M') { el.mute.click(); }
  else if (k === 'f' || k === 'F') { fullscreen(); }
  else if (k === '+' || k === '=') { setVolume(0.1); }
  else if (k === '-') { setVolume(-0.1); }
  else if (/^[1-9]$/.test(k)) {
    const v = list()[Number(k) - 1];
    if (v) { unlockSound(); void tune(v); } else toast(`No tape ${k} on this channel`);
  }
});

/* ---------------- boot ---------------- */
(async function boot() {
  renderChannels();
  setScreenState('boot', 'STAND BY', 'Tuning in…');
  powerOnFx();
  try {
    state.videos = await fetchVideos();
  } catch {
    setScreenState('error', 'STAND BY', 'The broadcast tower is warming up. Try again in a minute.');
    el.plTitle.textContent = 'Gali TV is warming up';
    el.plDesc.textContent = 'We could not reach the broadcast. Refresh in a moment.';
    el.plMeta.innerHTML = '<span class="chip">NO SIGNAL</span>';
    renderShelf();
    syncPlayUi();
    return;
  }
  state.latestId = state.videos[0]?.id ?? null;
  const want = new URLSearchParams(location.search).get('v');
  const first = (want && byId(want)) || state.videos[0] || null;
  renderShelf();
  if (!first) {
    setScreenState('empty', 'OFF AIR', 'First broadcast soon');
    renderPlaque(null);
    syncPlayUi();
    return;
  }
  el.video.muted = true;
  await tune(first, { quiet: true });
})();
