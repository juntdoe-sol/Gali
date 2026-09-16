import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';
import * as Haptics from 'expo-haptics';

const SOURCES = {
  select: require('../../assets/sfx/select.wav'),
  deselect: require('../../assets/sfx/deselect.wav'),
  dig: require('../../assets/sfx/dig.wav'),
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
} as const;
export type Sound = keyof typeof SOURCES;

const players = new Map<Sound, AudioPlayer>();
let muted = false;
let ready = false;

export function initAudio() {
  if (ready) return;
  ready = true;
  setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
  (Object.keys(SOURCES) as Sound[]).forEach((k) => {
    try {
      const p = createAudioPlayer(SOURCES[k]);
      p.volume = 0.7;
      players.set(k, p);
    } catch {
      /* audio unavailable */
    }
  });
}

export const setMuted = (m: boolean) => {
  muted = m;
};

export function play(s: Sound) {
  if (muted) return;
  const p = players.get(s);
  if (!p) return;
  try {
    void Promise.resolve(p.seekTo(0)).catch(() => undefined);
    const r = p.play() as unknown;
    if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => undefined);
  } catch {
    /* ignore */
  }
}

export const haptic = {
  tap: () => Haptics.selectionAsync().catch(() => undefined),
  thud: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined),
  win: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined),
  lose: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => undefined),
};
