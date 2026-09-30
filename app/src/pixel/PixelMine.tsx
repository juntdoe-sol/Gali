/**
 * The island, as the app sees it: a bridge between the game state and the
 * canvas engine.
 *
 * Ten times a second this reads the store and the live world, packs what the
 * picture needs into a Snapshot and pushes it if anything changed. The engine
 * sends back taps, sounds and where your miner is. Nothing here draws.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { chainReady } from '../chain/light';
import { BLOCKS, CAVE_IN_EVERY, GEAR, LOCK_MS, gearByKey, levelFromXp, type Gear } from '../game/constants';
import { soloMask } from '../game/pot';
import { play, type Sound } from '../game/sfx';
import { roundEnd, useGame } from '../game/store';
import { clearBots, ensureBots, EMOTES, publishMe, startWorld, stopWorld, thinkBots, useWorld, type Avatar } from '../game/world';
import { CLAIMS, openSpot } from '../engine/island';
import type { EngineEvent, Look, PeerView, Snapshot } from '../engine/types';
import { fx } from './fx';
import { atlasSource } from './atlasSource';
import GameView, { type GameRef } from './GameView';
import { useView } from './view';

const STANDS = CLAIMS.map((c) => c.stand as unknown as [number, number]);
const GLOW: Record<Gear['rarity'], Look['glow']> = { common: 'none', rare: 'rare', epic: 'epic', legendary: 'legendary' };
const byColor = (kind: Gear['kind'], color: string | null | undefined) => (color ? GEAR.find((g) => g.kind === kind && g.color.toLowerCase() === color.toLowerCase()) : undefined);
const pickByAccent = (color: string) => GEAR.find((g) => g.kind === 'pickaxe' && g.accent.toLowerCase() === color.toLowerCase());

/** The panel height when a claim is open; set by ClaimPanel. */
export const closeupView = { top: 160, bottom: 260 };

function lookOfPeer(p: Avatar): Look {
  const pick = pickByAccent(p.pick);
  return {
    hat: p.hk ?? byColor('helmet', p.hat)?.key ?? 'hat-yellow',
    fit: p.fit,
    pick: p.pick,
    handle: pick?.color ?? '#6b4a32',
    pet: p.pk ?? (p.pet ? byColor('pet', p.pet)?.key ?? 'pet-mole' : null),
    glow: pick ? GLOW[pick.rarity] : 'none',
  };
}

function myGear() {
  const st = useGame.getState();
  const pick = gearByKey(st.save.pickaxe) ?? GEAR[0];
  const hat = gearByKey(st.save.helmet) ?? GEAR[6];
  const fit = gearByKey(st.save.outfit) ?? GEAR[12];
  const pet = gearByKey(st.save.pet) ?? null;
  return { pick, hat, fit, pet };
}

function snapshot(): Snapshot {
  const st = useGame.getState();
  const world = useWorld.getState();
  const now = Date.now();
  const { pick, hat, fit, pet } = myGear();
  const potNow = st.pot.roundId === st.roundId ? st.pot : null;
  const pend = st.pending;
  const mine = Array.from({ length: BLOCKS }, (_, i) => (pend && pend.mask & (1 << i) ? pend.perBlock : 0));
  const emo = (id: string) => {
    const e = world.emotes[id];
    return e && now - e.at < 2500 ? e.emoji : null;
  };
  const focus = useView.getState().focus;
  const peers: PeerView[] = Object.values(world.peers).map((p) => ({
    id: p.id,
    name: p.name,
    x: Math.round(p.x * 10) / 10,
    y: Math.round(p.y * 10) / 10,
    tx: p.tx,
    ty: p.ty,
    facing: p.facing,
    pose: p.pose,
    look: lookOfPeer(p),
    tone: p.bot ? 'bot' : p.wallet ? 'verified' : 'guest',
    emoji: emo(p.id),
  }));
  return {
    view: focus >= 0 ? { top: closeupView.top, bottom: closeupView.bottom } : { top: fx.viewTop, bottom: fx.viewBottom },
    phase: st.phase,
    roundId: st.roundId,
    roundEndsAt: roundEnd(st.roundId) - st.offsetMs,
    lockMs: LOCK_MS,
    settleStartAt: st.settleStartAt,
    revealStartAt: st.revealStartAt,
    winner: st.phase === 'reveal' ? st.winning : null,
    motherlode: st.phase === 'reveal' && st.revealMotherlode,
    caveIn: st.roundId % CAVE_IN_EVERY === 0,
    selected: st.selected,
    pending: pend?.mask ?? 0,
    solo: soloMask(st.roundId),
    perBlock: potNow ? potNow.perBlock.map((v) => Math.round(v * 1e5) / 1e5) : Array(BLOCKS).fill(0),
    mine,
    me: {
      look: { hat: hat.key, fit: fit.color, pick: pick.accent, handle: pick.color, pet: pet?.key ?? null, glow: GLOW[pick.rarity] },
      emoji: emo(world.me),
      emoteAt: st.emote,
      name: 'You',
    },
    peers,
    practice: !(st.wallet.owner && chainReady),
    quality: 1,
    amounts: st.dockTab === 'pro',
  };
}

/** Other miners walk toward where they said they were going; bots decide where next. */
function stepPeers(dt: number) {
  const st = useGame.getState();
  const world = useWorld.getState();
  const practice = !(st.wallet.owner && chainReady);
  if (practice && world.status !== 'online') {
    ensureBots(STANDS);
    thinkBots(STANDS, () => openSpot());
  } else clearBots();
  for (const p of Object.values(useWorld.getState().peers)) {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    if (d < 0.3) {
      if (p.bot && p.pose === 'walk') p.pose = 'idle';
      continue;
    }
    if (Math.abs(dx) > 0.5) p.facing = dx > 0 ? 1 : -1;
    const k = Math.min(1, ((p.bot ? 34 : 52) * dt) / d);
    p.x += dx * k;
    p.y += dy * k;
  }
}

const SFX: Record<string, Sound> = { hit: 'hit', pop: 'pop', crack: 'crack', select: 'select', deselect: 'deselect', whoosh: 'dig', bonk: 'bonk' };

export default function PixelMine() {
  const ref = useRef<GameRef>(null);
  const request = useView((s) => s.request);
  const [atlas, setAtlas] = useState<string | null>(null);
  useEffect(() => {
    atlasSource().then(setAtlas, () => setAtlas('/pixel/atlas.png'));
  }, []);

  useEffect(() => {
    startWorld();
    let last = Date.now();
    let sent = '';
    const id = setInterval(() => {
      const now = Date.now();
      stepPeers(Math.min(0.3, (now - last) / 1000));
      last = now;
      const snap = snapshot();
      const json = JSON.stringify(snap);
      if (json !== sent && ref.current) {
        sent = json;
        ref.current.push(snap);
      }
    }, 100);
    return () => {
      clearInterval(id);
      stopWorld();
    };
  }, []);

  useEffect(() => {
    if (request === null) return;
    ref.current?.focus(request);
    useView.setState({ request: null });
  }, [request]);

  const onEvent = useCallback((e: EngineEvent) => {
    const st = useGame.getState();
    switch (e.t) {
      case 'ready':
        useView.setState({ ready: true });
        break;
      case 'focus':
        useView.setState({ focus: e.claim });
        break;
      case 'toggle': {
        const was = st.selected.includes(e.claim);
        st.toggleBlock(e.claim);
        play(was ? 'deselect' : 'select');
        break;
      }
      case 'bonk':
        st.bonkMole();
        break;
      case 'sfx':
        if (SFX[e.name]) play(SFX[e.name]);
        break;
      case 'peer':
        useWorld.getState().setFocus(e.id);
        break;
      case 'emote':
        st.doEmote();
        useWorld.getState().emote(EMOTES[Math.floor(Math.random() * EMOTES.length)]);
        break;
      case 'me': {
        const { pick, hat, fit, pet } = myGear();
        const session = st.session();
        const player = st.wallet.player;
        const lvl = levelFromXp(player ? player.xp + st.save.bonusXp : st.save.xp);
        const pose = e.pose === 'walk' || e.pose === 'swing' ? e.pose : 'idle';
        publishMe(
          { x: e.x, y: e.y, tx: e.tx, ty: e.ty, facing: e.facing, pose, hat: hat.color, fit: fit.color, pick: pick.accent, pet: pet?.color ?? null, lvl, hk: hat.key, pk: pet?.key ?? null },
          { wallet: st.wallet.owner, session, sessionValid: Boolean(player && session && player.session === session.publicKey.toBase58() && player.sessionExpires * 1000 > Date.now()) },
        );
        break;
      }
      default:
        break;
    }
  }, []);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#123a6b' }]}>
      {atlas ? <GameView ref={ref} onEvent={onEvent} atlas={atlas} dom={{ style: { flex: 1, backgroundColor: '#123a6b' }, scrollEnabled: false, bounces: false, overScrollMode: 'never' } as never} /> : null}
      <RevealSounds />
    </View>
  );
}

function RevealSounds() {
  const phase = useGame((s) => s.phase);
  useEffect(() => {
    if (phase !== 'reveal') return;
    const ids = [0, 200, 400, 600, 800].map((d) => setTimeout(() => play('crack'), d));
    return () => ids.forEach(clearTimeout);
  }, [phase]);
  return null;
}
