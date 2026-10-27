/**
 * Sound that follows the game's state: the music for the place you are in, the door between places,
 * fight sounds and your miner's cries, the arena announcer and the island's new rounds.
 * One-off moments (a gold strike, a level up, a KO you land) call sfx directly where they happen.
 */
import { useArena } from './arena';
import { useBrawl } from './brawl';
import { useCave } from './caveStore';
import { useLobby } from './lobby';
import { announce, bark, onAudioReady, play, setMusic, setMusicOff, type Track } from './sfx';
import { useGame } from './store';
import { useName } from './username';

/** Hollow Night: the lobby plays the haunted theme for the Halloween season (Malaysia time). */
const HOLLOW_FROM = Date.parse('2026-10-24T00:00:00+08:00');
const HOLLOW_TO = Date.parse('2026-11-05T23:59:59+08:00');
const NEW_ROUND_GAP_MS = 5 * 60_000;

const sex = () => (useName.getState().sex === 'f' ? 'f' : 'm');

function place(): Track {
  if (useArena.getState().open) return 'arena';
  if (useCave.getState().open) return 'cave';
  if (useLobby.getState().where === 'island') return 'island';
  const now = Date.now();
  return now >= HOLLOW_FROM && now <= HOLLOW_TO ? 'hollow-night' : 'lobby';
}

let started = false;
let here: Track | null = null;
let welcomed = false;
let lastNewRound = 0;

/** "Welcome to Gali" once a session: when sound is on and a wallet is in, whichever comes last. */
let soundOn = false;
function tryWelcome() {
  if (welcomed || !soundOn || !useGame.getState().wallet.owner) return;
  welcomed = true;
  setTimeout(() => announce('welcome'), 1200);
}

function syncPlace() {
  const p = place();
  if (here && p !== here) play('door');
  here = p;
  setMusic(p);
}

export function startSoundscape() {
  if (started) return;
  started = true;
  syncPlace();
  setMusicOff(Boolean(useGame.getState().save.musicOff));
  onAudioReady(() => {
    soundOn = true;
    tryWelcome();
  });

  useLobby.subscribe((s, o) => {
    if (s.where !== o.where) syncPlace();
  });
  useCave.subscribe((s, o) => {
    if (s.open !== o.open) syncPlace();
  });

  useGame.subscribe((s, o) => {
    if (s.save.musicOff !== o.save.musicOff) setMusicOff(Boolean(s.save.musicOff));
    // the first time a wallet is in, the announcer says hello
    if (s.wallet.owner && !o.wallet.owner) tryWelcome();
    // a new round on the island (now and then, not every minute)
    if (s.roundId !== o.roundId && o.roundId > 0 && useLobby.getState().where === 'island' && !useArena.getState().open && !useCave.getState().open) {
      const now = Date.now();
      if (now - lastNewRound > NEW_ROUND_GAP_MS) {
        lastNewRound = now;
        announce('new-round');
      }
    }
  });

  // your miner in a fight
  useBrawl.subscribe((s, o) => {
    const m = s.me;
    const p = o.me;
    if (s.myJumpAt && s.myJumpAt !== o.myJumpAt) {
      play('jump');
      bark('jump', sex(), 0.3);
    }
    if (m.swingAt && m.swingAt !== p.swingAt) bark('hit', sex(), 0.3);
    if (m.koAt && !p.koAt) {
      play('ko');
      bark('ko', sex());
    } else if (m.hitAt && m.hitAt !== p.hitAt && m.hp < p.hp) {
      play('hit');
      bark('hurt', sex(), 0.5);
    }
    if (m.respawn > p.respawn) play('respawn');
  });

  // the arena announcer
  useArena.subscribe((s, o) => {
    if (s.open !== o.open) syncPlace();
    const m = s.match;
    if (!s.open || m.phase === o.match.phase) return;
    if (m.phase === 'count') {
      if (m.mode === 'boss') announce('boss-incoming');
      else if (m.mode === 'lms') announce('last-standing');
    } else if (m.phase === 'fight') {
      setTimeout(() => announce('fight'), 150);
    } else if (m.phase === 'end') {
      const won = m.winner === s.me || m.winner === 'boss-down' || m.winner === 'waves-won';
      if (won) {
        announce('victory');
        setTimeout(() => bark('win', sex()), 1100);
      }
    }
  });
}
