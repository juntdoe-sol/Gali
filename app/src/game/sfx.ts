import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import { Asset } from 'expo-asset';
import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * The web plays everything through one Web Audio context: browsers (Safari above all) refuse
 * audio elements that were not started by a tap, but a context unlocked once by the first tap
 * or key press plays anything after. The app keeps expo-audio.
 */
const WEB = Platform.OS === 'web';
type Ctx = AudioContext;
let ctx: Ctx | null = null;
let busSfx: GainNode | null = null;
let busVoice: GainNode | null = null;
let busMusic: GainNode | null = null;
const bufs = new Map<string, AudioBuffer>();
const loading = new Map<string, Promise<AudioBuffer | null>>();
let musicNode: AudioBufferSourceNode | null = null;

function webInit() {
  if (ctx) return;
  const C = (globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!C) return;
  ctx = new C();
  const bus = (v: number) => {
    const g = ctx!.createGain();
    g.gain.value = v;
    g.connect(ctx!.destination);
    return g;
  };
  busSfx = bus(0.7);
  busVoice = bus(0.9);
  busMusic = bus(0.32);
  // keep the context awake: any later tap or key resumes it if the browser suspended it
  const wake = () => {
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  };
  wake();
  if (typeof window !== 'undefined') {
    window.addEventListener('pointerdown', wake, true);
    window.addEventListener('keydown', wake, true);
  }
}

function webLoad(key: string, src: number): Promise<AudioBuffer | null> {
  const have = bufs.get(key);
  if (have) return Promise.resolve(have);
  let p = loading.get(key);
  if (!p) {
    p = fetch(Asset.fromModule(src).uri)
      .then((r) => r.arrayBuffer())
      .then((a) => new Promise<AudioBuffer>((ok, bad) => ctx!.decodeAudioData(a, ok, bad)))
      .then((b) => {
        bufs.set(key, b);
        return b;
      })
      .catch(() => null);
    loading.set(key, p);
  }
  return p;
}

function webShot(key: string, src: number, bus: GainNode | null) {
  if (!ctx || !bus) return;
  if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);
  const go = (b: AudioBuffer) => {
    const n = ctx!.createBufferSource();
    n.buffer = b;
    n.connect(bus);
    n.start();
  };
  const b = bufs.get(key);
  if (b) go(b);
  else {
    const asked = Date.now();
    // a sound still loading plays when it arrives, unless that is too late to belong to the moment
    void webLoad(key, src).then((x) => x && Date.now() - asked < 600 && go(x));
  }
}

const SOURCES = {
  select: require('../../assets/sfx/select.wav'),
  deselect: require('../../assets/sfx/deselect.wav'),
  dig: require('../../assets/sfx/dig.wav'),
  // soft digging for mining swings, three takes (scripts/sfx/soft-dig.py)
  dirt0: require('../../assets/sfx/dirt-0.wav'),
  dirt1: require('../../assets/sfx/dirt-1.wav'),
  dirt2: require('../../assets/sfx/dirt-2.wav'),
  tick: require('../../assets/sfx/tick.wav'),
  rumble: require('../../assets/sfx/rumble.wav'),
  crack: require('../../assets/sfx/crack.wav'),
  hit: require('../../assets/sfx/hit.wav'),
  win: require('../../assets/sfx/win.wav'),
  lose: require('../../assets/sfx/lose.wav'),
  motherlode: require('../../assets/sfx/motherlode.wav'),
  claim: require('../../assets/sfx/claim.wav'),
  bonk: require('../../assets/sfx/bonk.wav'),
  pop: require('../../assets/sfx/pop.wav'),
  levelup: require('../../assets/sfx/levelup.wav'),
  mint: require('../../assets/sfx/mint.wav'),
  button: require('../../assets/sfx/button.wav'),
  chat: require('../../assets/sfx/chat.wav'),
  jump: require('../../assets/sfx/jump.wav'),
  step: require('../../assets/sfx/step.wav'),
  door: require('../../assets/sfx/door.wav'),
  ko: require('../../assets/sfx/ko.wav'),
  respawn: require('../../assets/sfx/respawn.wav'),
} as const;
export type Sound = keyof typeof SOURCES;

/** The game voice for big moments. */
const ANNOUNCER = {
  welcome: require('../../assets/voice/announcer-welcome.wav'),
  'new-round': require('../../assets/voice/announcer-new-round.wav'),
  'gold-strike': require('../../assets/voice/announcer-gold-strike.wav'),
  motherlode: require('../../assets/voice/announcer-motherlode.wav'),
  'level-up': require('../../assets/voice/announcer-level-up.wav'),
  fight: require('../../assets/voice/announcer-fight.wav'),
  ko: require('../../assets/voice/announcer-ko.wav'),
  victory: require('../../assets/voice/announcer-victory.wav'),
  'last-standing': require('../../assets/voice/announcer-last-standing.wav'),
  'boss-incoming': require('../../assets/voice/announcer-boss-incoming.wav'),
} as const;
export type Line = keyof typeof ANNOUNCER;

/** Your miner's own cries, in the boy or girl voice. */
const BARKS = {
  m: {
    hit: require('../../assets/voice/boy-hit.wav'), jump: require('../../assets/voice/boy-jump.wav'), hurt: require('../../assets/voice/boy-hurt.wav'),
    ko: require('../../assets/voice/boy-ko.wav'), win: require('../../assets/voice/boy-win.wav'), levelup: require('../../assets/voice/boy-levelup.wav'),
    dig: require('../../assets/voice/boy-dig.wav'), taunt: require('../../assets/voice/boy-taunt.wav'),
  },
  f: {
    hit: require('../../assets/voice/girl-hit.wav'), jump: require('../../assets/voice/girl-jump.wav'), hurt: require('../../assets/voice/girl-hurt.wav'),
    ko: require('../../assets/voice/girl-ko.wav'), win: require('../../assets/voice/girl-win.wav'), levelup: require('../../assets/voice/girl-levelup.wav'),
    dig: require('../../assets/voice/girl-dig.wav'), taunt: require('../../assets/voice/girl-taunt.wav'),
  },
} as const;
export type Bark = keyof (typeof BARKS)['m'];

/** One looping track per place. */
const MUSIC = {
  lobby: require('../../assets/music/lobby.mp3'),
  island: require('../../assets/music/island.mp3'),
  arena: require('../../assets/music/arena.mp3'),
  cave: require('../../assets/music/cave.mp3'),
  'hollow-night': require('../../assets/music/hollow-night.mp3'),
} as const;
export type Track = keyof typeof MUSIC;

const SFX_VOL = 0.7;
const VOICE_VOL = 0.9;
const MUSIC_VOL = 0.32;

const players = new Map<Sound, AudioPlayer>();
const voices = new Map<string, AudioPlayer>();
const tracks = new Map<Track, AudioPlayer>();
let muted = false;
let musicOff = false;
let ready = false;
let want: Track | null = null;
const readyHooks: (() => void)[] = [];
/** Runs `f` once sound is unlocked (at once if it already is). */
export function onAudioReady(f: () => void) {
  if (ready) f();
  else readyHooks.push(f);
}
const fireReady = () => readyHooks.splice(0).forEach((f) => f());
let playing: Track | null = null;

export function initAudio() {
  if (ready) return;
  ready = true;
  if (WEB) {
    webInit();
    (Object.keys(SOURCES) as Sound[]).forEach((k) => void webLoad(`s:${k}`, SOURCES[k]));
    (Object.keys(ANNOUNCER) as Line[]).forEach((k) => void webLoad(`a:${k}`, ANNOUNCER[k]));
    (['m', 'f'] as const).forEach((x) => (Object.keys(BARKS[x]) as Bark[]).forEach((k) => void webLoad(`${x}:${k}`, BARKS[x][k])));
    syncMusic();
    fireReady();
    return;
  }
  setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
  (Object.keys(SOURCES) as Sound[]).forEach((k) => {
    try {
      const p = createAudioPlayer(SOURCES[k]);
      p.volume = SFX_VOL;
      players.set(k, p);
    } catch {
      /* audio unavailable */
    }
  });
  syncMusic();
  fireReady();
}

export const setMuted = (m: boolean) => {
  muted = m;
  syncMusic();
};
export const setMusicOff = (off: boolean) => {
  musicOff = off;
  syncMusic();
};

function start(p: AudioPlayer) {
  try {
    void Promise.resolve(p.seekTo(0)).catch(() => undefined);
    const r = p.play() as unknown;
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

let lastDirt = -1;
/** One soft dig, never the same take twice in a row. */
export function playDirt() {
  let k = Math.floor(Math.random() * 3);
  if (k === lastDirt) k = (k + 1) % 3;
  lastDirt = k;
  play((['dirt0', 'dirt1', 'dirt2'] as const)[k]);
}

export function play(s: Sound) {
  if (muted) return;
  if (WEB) return webShot(`s:${s}`, SOURCES[s], busSfx);
  const p = players.get(s);
  if (p) start(p);
}

function voice(key: string, src: number) {
  if (muted || !ready) return;
  if (WEB) return webShot(key, src, busVoice);
  let p = voices.get(key);
  if (!p) {
    try {
      p = createAudioPlayer(src);
      p.volume = VOICE_VOL;
      voices.set(key, p);
    } catch {
      return;
    }
  }
  start(p);
}

let lastLine = 0;
/** The announcer. Lines never stack: one at most every 1.2 s. */
export function announce(line: Line) {
  const now = Date.now();
  if (now - lastLine < 1200) return;
  lastLine = now;
  voice(`a:${line}`, ANNOUNCER[line]);
}

let lastBark = 0;
/** Your miner's cry. `chance` keeps frequent actions (every swing, every jump) from talking every time. */
export function bark(kind: Bark, sex: 'm' | 'f', chance = 1) {
  const now = Date.now();
  if (now - lastBark < 700 || Math.random() > chance) return;
  lastBark = now;
  voice(`${sex}:${kind}`, BARKS[sex][kind]);
}

/** Pick the place's track; it starts once audio is unlocked and keeps going until the place changes. */
export function setMusic(t: Track | null) {
  want = t;
  syncMusic();
}

function syncMusic() {
  if (!ready) return;
  const next = muted || musicOff ? null : want;
  if (next === playing) return;
  if (WEB) {
    playing = next;
    try {
      musicNode?.stop();
    } catch {
      /* already stopped */
    }
    musicNode = null;
    if (!next || !ctx) return;
    const t = next;
    void webLoad(`m:${t}`, MUSIC[t]).then((b) => {
      if (!b || !ctx || playing !== t || musicNode) return;
      const n = ctx.createBufferSource();
      n.buffer = b;
      n.loop = true;
      n.connect(busMusic!);
      n.start();
      musicNode = n;
    });
    return;
  }
  if (playing) {
    try {
      tracks.get(playing)?.pause();
    } catch {
      /* ignore */
    }
  }
  playing = next;
  if (!next) return;
  let p = tracks.get(next);
  if (!p) {
    try {
      p = createAudioPlayer(MUSIC[next]);
      p.loop = true;
      p.volume = MUSIC_VOL;
      tracks.set(next, p);
    } catch {
      playing = null;
      return;
    }
  }
  start(p);
}

export const haptic = {
  tap: () => Haptics.selectionAsync().catch(() => undefined),
  thud: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined),
  win: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  lose: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};
