// Silent stand-in for game/sfx in node tests: the real module loads audio files and expo-audio.
const noop = (..._a: unknown[]) => {};
export const play = noop, announce = noop, bark = noop, setMusic = noop, setMuted = noop, setMusicOff = noop, onAudioReady = noop, initAudio = noop;
export const haptic = { win: noop, thud: noop, tap: noop, heavy: noop, light: noop };
