// Gali Island: 25 claims with real ground between them, a miner who works the
// ones you picked, a mole to bonk, ships on the water and the strike animation.
// Drawn with plain Images at 12 fps.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View, type ImageStyle } from 'react-native';
import { chainReady } from '../chain/client';
import { BLOCKS, CAVE_IN_EVERY, GEAR, gearByKey, levelFromXp } from '../game/constants';
import { soloMask } from '../game/pot';
import { play } from '../game/sfx';
import { roundEnd, useGame } from '../game/store';
import { clearBots, ensureBots, publishMe, startWorld, stopWorld, thinkBots, useWorld, type Avatar, type Pose } from '../game/world';
import { F } from '../ui/kit';
import { fx, revealEl } from './fx';
import {
  BIRD_ANCHOR,
  CLAIMS,
  ICON_ANCHOR,
  ISLE,
  MAP_H,
  MAP_W,
  SHIPS,
  SHIP_ANCHOR,
  claimForTap,
  openSpot,
  shipAt,
  toLand,
} from './island';
import { META, SPRITES, type SpriteName } from './sprites';

const [MNW, MNH] = META.miner;
const FPS = 12;
const SEA = '#123a6b';

const SOLO_STAR = {
  position: 'absolute' as const,
  color: '#ffd84a',
  fontFamily: F.display,
  textShadowColor: '#3a1d00',
  textShadowOffset: { width: 1, height: 1 },
  textShadowRadius: 0,
};
const CLAIM_AMT = {
  position: 'absolute' as const,
  alignItems: 'center' as const,
  backgroundColor: '#070d20cc',
  borderWidth: 1,
  borderRadius: 3,
};
/** Compact SOL amount for a claim label: 0, .004, 0.12, 1.2, 12 */
const fmtAmt = (v: number) => (v <= 0 ? '0' : v < 0.001 ? '<.001' : v < 0.01 ? `.${Math.round(v * 1000).toString().padStart(3, '0')}` : v < 1 ? v.toFixed(2) : v < 10 ? v.toFixed(1) : Math.round(v).toString());
const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Feet-on-the-ground point for a sprite drawn from its top-left corner. */
const footOf = (x: number, y: number): [number, number] => [x + MNW / 2, y + MNH];
const fromFoot = (x: number, y: number): [number, number] => [x - MNW / 2, y - MNH];

const HOME = fromFoot(ISLE.home[0], ISLE.home[1]);
/** Where a character stands to work claim `i`: on its own ground, never in the sea. */
const standAt = (i: number): [number, number] => fromFoot(CLAIMS[i].stand[0], CLAIMS[i].stand[1]);

// browsers smooth scaled images; pixel art should stay crisp
if (Platform.OS === 'web' && typeof document !== 'undefined' && !document.getElementById('gali-pixel-css')) {
  const el = document.createElement('style');
  el.id = 'gali-pixel-css';
  el.textContent = '[data-pixel] img, [data-pixel] div { image-rendering: pixelated; image-rendering: crisp-edges; }';
  document.head.appendChild(el);
}

function useFrameClock() {
  const [, setN] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setN((n) => (n + 1) % 1_000_000), 1000 / FPS);
    return () => clearInterval(id);
  }, []);
  return Date.now();
}

type SpriteProps = { name: SpriteName; x: number; y: number; w: number; h: number; s: number; tint?: string; opacity?: number; flip?: boolean };
function Sprite({ name, x, y, w, h, s, tint, opacity, flip }: SpriteProps) {
  const style: ImageStyle = {
    position: 'absolute',
    left: Math.round(x * s),
    top: Math.round(y * s),
    width: Math.round(w * s),
    height: Math.round(h * s),
    opacity,
    tintColor: tint,
    transform: flip ? [{ scaleX: -1 }] : undefined,
  };
  return <Image source={SPRITES[name]} style={style} fadeDuration={0} />;
}

/**
 * A claim's own shape, tinted.
 *
 * Every claim ships as two cropped images, a solid fill and its outline, so
 * lighting one up is two draws rather than a polygon redrawn every frame.
 */
function ClaimShape({ i, s, tint, fill, edge }: { i: number; s: number; tint: string; fill: number; edge: number }) {
  const [x, y, w, h] = CLAIMS[i].box;
  return (
    <View pointerEvents="none">
      {fill > 0 ? <Sprite name={`claim-${i}-fill` as SpriteName} x={x} y={y} w={w} h={h} s={s} tint={tint} opacity={fill} /> : null}
      {edge > 0 ? <Sprite name={`claim-${i}-edge` as SpriteName} x={x} y={y} w={w} h={h} s={s} tint={tint} opacity={edge} /> : null}
    </View>
  );
}

type Item = { z: number; key: string; node: ReactNode };

type Look = { hat: string; fit: string; pick: string };
function frameFor(pose: Pose, now: number, since: number) {
  if (pose === 'walk') return Math.floor(now / 120) % 4;
  if (pose === 'swing') return Math.min(2, Math.floor(((now - since) % 330) / 110));
  return Math.floor(now / 500) % 2;
}
function MinerSprite({ x, y, s, facing, pose, frame, look }: { x: number; y: number; s: number; facing: number; pose: Pose; frame: number; look: Look }) {
  const layers: [SpriteName, string | undefined][] = [
    [`miner-${pose}-${frame}` as SpriteName, undefined],
    [`miner-${pose}-${frame}-fit` as SpriteName, look.fit],
    [`miner-${pose}-${frame}-fit-shade` as SpriteName, undefined],
    [`miner-${pose}-${frame}-hat` as SpriteName, look.hat],
    [`miner-${pose}-${frame}-hat-shade` as SpriteName, undefined],
    [`miner-${pose}-${frame}-pick` as SpriteName, look.pick],
    [`miner-${pose}-${frame}-pick-shade` as SpriteName, undefined],
  ];
  return (
    <View
      pointerEvents="none"
      style={{ position: 'absolute', left: Math.round(x * s), top: Math.round(y * s), width: MNW * s, height: MNH * s, transform: facing < 0 ? [{ scaleX: -1 }] : undefined }}
    >
      {layers.map(([name, tint]) => (
        <Sprite key={name} name={name} x={0} y={0} w={MNW} h={MNH} s={s} tint={tint} />
      ))}
    </View>
  );
}
function PetSprite({ x, y, s, tint, now }: { x: number; y: number; s: number; tint: string; now: number }) {
  const pf = Math.floor(now / 250) % 2;
  return (
    <View pointerEvents="none">
      <Sprite name={`pet-${pf}-tint` as SpriteName} x={x} y={y} w={12} h={12} s={s} tint={tint} />
      <Sprite name={`pet-${pf}-shade` as SpriteName} x={x} y={y} w={12} h={12} s={s} />
    </View>
  );
}
function Tag({ x, y, s, text, tone, emoji }: { x: number; y: number; s: number; text: string; tone: 'me' | 'verified' | 'guest' | 'bot'; emoji?: string }) {
  const fs = Math.max(10, Math.round(4 * s));
  const bg = tone === 'me' ? '#ffcf4a' : tone === 'verified' ? '#14f195' : tone === 'bot' ? '#8ea2cc' : '#f2f5ff';
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: (x + MNW / 2) * s - 60, top: y * s - fs * 2.2 - (emoji ? fs * 2.2 : 0), width: 120, alignItems: 'center' }}>
      {emoji ? <Text style={{ fontSize: fs * 1.8, lineHeight: fs * 2.2 }}>{emoji}</Text> : null}
      <View style={{ backgroundColor: '#070d20d9', borderColor: bg, borderWidth: 1, borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1 }}>
        <Text numberOfLines={1} style={{ color: bg, fontFamily: F.display, fontSize: fs, lineHeight: fs * 1.25 }}>
          {text}
        </Text>
      </View>
    </View>
  );
}

type MinerState = { x: number; y: number; tx: number; ty: number; mode: 'idle' | 'walk' | 'swing'; since: number; target: number; hitCycle: number; facing: 1 | -1; last: number };
type MoleState = { idx: number; start: number; nextAt: number; bonkedAt: number };

/** Flocks drift across the water and wrap round the edge. */
const FLOCKS = Array.from({ length: 4 }, (_, i) => ({
  x: seeded(i * 3.1) * MAP_W,
  y: MAP_H * 0.08 + seeded(i * 5.7) * MAP_H * 0.7,
  sp: 5 + seeded(i * 9.3) * 6,
  dir: seeded(i * 11.9) > 0.5 ? 1 : -1,
  n: 2 + Math.floor(seeded(i * 7.1) * 3),
}));

export default function PixelMine() {
  const { width: W, height: H } = useWindowDimensions();
  const now = useFrameClock();
  const st = useGame.getState();
  const toggle = st.toggleBlock;
  const world = useWorld.getState();
  const practice = !(st.wallet.owner && chainReady);
  useEffect(() => {
    startWorld();
    return () => stopWorld();
  }, []);
  const manualUntil = useRef(0);

  // ---- fit the island between the HUD and the deploy panel ----
  const top = Math.min(fx.viewTop, H * 0.45);
  const bottom = Math.min(fx.viewBottom, H * 0.5);
  const band = Math.max(120, H - top - bottom);
  const want = Math.min(W / MAP_W, band / MAP_H);
  const scale = useRef(want);
  scale.current += (want - scale.current) * 0.35;
  if (Math.abs(want - scale.current) < 0.01) scale.current = want;
  const s = scale.current;
  const left = W / 2 - (MAP_W / 2) * s;
  const topPx = top + band / 2 - (MAP_H / 2) * s;

  // ---- reveal state ----
  const el = revealEl();
  const winner = st.phase === 'reveal' ? st.winning : null;
  const cave = st.roundId % CAVE_IN_EVERY === 0;
  const shake = el >= 0 && el < 1400 ? (seeded(now / 50) - 0.5) * 2 * Math.min(1, el / 700) : el > 2500 && el < 2850 ? (seeded(now / 40) - 0.5) * 3 : 0;
  const pendMask = st.pending?.mask ?? 0;
  const mining = st.phase === 'mining' && roundEnd(st.roundId) - st.offsetMs - Date.now() > 5000;

  // ---- your miner ----
  const mref = useRef<MinerState>({ x: HOME[0], y: HOME[1], tx: HOME[0], ty: HOME[1], mode: 'idle', since: now, target: -1, hitCycle: -1, facing: 1, last: now });
  const m = mref.current;
  const dt = Math.min(0.25, (now - m.last) / 1000);
  m.last = now;
  const claims = [...Array(BLOCKS).keys()].filter((i) => pendMask & (1 << i));
  const work = el >= 0 ? [] : claims.length ? claims : st.selected;
  const goTo = (tx: number, ty: number, target: number) => {
    m.tx = tx;
    m.ty = ty;
    m.target = target;
    m.mode = 'walk';
    m.since = now;
  };
  if (m.mode === 'walk') {
    const dx = m.tx - m.x;
    const dy = m.ty - m.y;
    const d = Math.hypot(dx, dy);
    const step = 52 * dt;
    if (Math.abs(dx) > 0.5) m.facing = dx > 0 ? 1 : -1;
    if (d <= step) {
      m.x = m.tx;
      m.y = m.ty;
      m.mode = m.target >= 0 ? 'swing' : 'idle';
      m.since = now;
      m.hitCycle = -1;
      if (m.target >= 0) m.facing = 1;
    } else {
      m.x += (dx / d) * step;
      m.y += (dy / d) * step;
    }
    if (m.target >= 0 && !work.includes(m.target)) {
      m.tx = m.x;
      m.ty = m.y;
      m.target = -1;
      m.mode = 'idle';
    }
  } else if (m.mode === 'swing') {
    const cycle = Math.floor((now - m.since) / 330);
    if (cycle !== m.hitCycle && (now - m.since) % 330 > 220) {
      m.hitCycle = cycle;
      fx.hits.set(m.target, now);
      play('hit');
    }
    if (!work.includes(m.target) || cycle >= 3) {
      const next = work.length ? work[(work.indexOf(m.target) + 1) % work.length] : -1;
      if (next >= 0 && next !== m.target) goTo(...standAt(next), next);
      else if (next < 0) goTo(HOME[0], HOME[1], -1);
      else m.since = now; // only one claim: keep swinging
    }
  } else if (now < manualUntil.current) {
    // the player walked somewhere by hand: stay a while
  } else if (work.length) {
    goTo(...standAt(work[0]), work[0]);
  } else if (el >= 0 && Math.hypot(m.x - HOME[0], m.y - HOME[1]) > 1) {
    goTo(HOME[0], HOME[1], -1);
  }
  const won = winner !== null && winner !== undefined && pendMask & (1 << winner) && el > 2600;
  const dancing = now - st.emote < 2200 || won;
  const pose = m.mode === 'walk' ? 'walk' : m.mode === 'swing' ? 'swing' : 'idle';
  const frame = frameFor(pose, now, m.since);
  const jump = dancing ? -Math.abs(Math.sin(now / 130)) * 4 : 0;

  // ---- mole ----
  const oref = useRef<MoleState>({ idx: -1, start: 0, nextAt: now + 4000, bonkedAt: -1 });
  const mo = oref.current;
  const UP = 2400;
  if (mo.idx < 0) {
    fx.moleBlock = -1;
    if (mining && now > mo.nextAt) {
      const free = [...Array(BLOCKS).keys()].filter((i) => !(pendMask & (1 << i)) && !st.selected.includes(i));
      if (free.length) {
        mo.idx = free[Math.floor(Math.random() * free.length)];
        mo.start = now;
        mo.bonkedAt = -1;
        play('pop');
      } else mo.nextAt = now + 3000;
    }
  } else {
    const age = now - mo.start;
    const bonked = mo.bonkedAt > 0;
    if ((!bonked && age > UP) || (bonked && now - mo.bonkedAt > 700) || !mining || st.selected.includes(mo.idx)) {
      mo.idx = -1;
      mo.nextAt = now + 5000 + Math.random() * 6000;
      fx.moleBlock = -1;
    } else fx.moleBlock = mo.idx;
  }

  // ---- gear colours ----
  const pick = gearByKey(st.save.pickaxe) ?? GEAR[0];
  const hat = gearByKey(st.save.helmet) ?? GEAR[6];
  const fit = gearByKey(st.save.outfit) ?? GEAR[12];
  const pet = gearByKey(st.save.pet);
  const pref = useRef({ x: HOME[0] - 12, y: HOME[1] + 10 });
  if (pet) {
    pref.current.x += (m.x - 11 * m.facing - pref.current.x) * Math.min(1, dt * 3);
    pref.current.y += (m.y + 12 - pref.current.y) * Math.min(1, dt * 3);
  }

  // ---- everyone else ----
  const lvl = levelFromXp(st.wallet.player ? st.wallet.player.xp + st.save.bonusXp : st.save.xp);
  const stands = [...Array(BLOCKS).keys()].map(standAt);
  if (practice && world.status !== 'online') {
    ensureBots(stands);
    thinkBots(stands, () => fromFoot(...openSpot()));
  } else clearBots();
  const peers = Object.values(world.peers);
  for (const p of peers) {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const d = Math.hypot(dx, dy);
    const step = (p.bot ? 34 : 52) * dt;
    if (d > 0.3) {
      if (Math.abs(dx) > 0.5) p.facing = dx > 0 ? 1 : -1;
      const k = Math.min(1, step / d);
      p.x += dx * k;
      p.y += dy * k;
      if (p.bot && k === 1) p.pose = 'idle';
    }
  }
  const session = st.session();
  const player = st.wallet.player;
  publishMe(
    { x: m.x, y: m.y, tx: m.tx, ty: m.ty, facing: m.facing, pose, hat: hat.color, fit: fit.color, pick: pick.accent, pet: pet?.color ?? null, lvl },
    {
      wallet: st.wallet.owner,
      session,
      sessionValid: Boolean(player && session && player.session === session.publicKey.toBase58() && player.sessionExpires * 1000 > Date.now()),
    },
  );
  const emoteOf = (id: string) => {
    const e = world.emotes[id];
    return e && now - e.at < 2500 ? e.emoji : undefined;
  };

  // ---- claim lighting, under everything that stands on the ground ----
  const shapes: ReactNode[] = [];
  for (let i = 0; i < BLOCKS; i++) {
    const isWin = winner === i && el >= 2500;
    if (el >= 1400 && winner !== null && winner !== undefined && winner !== i) {
      const order = (i * 11) % BLOCKS;
      const k = Math.max(0, Math.min(1, (el - 1400 - order * 40) / 300));
      if (k > 0) shapes.push(<ClaimShape key={`dim${i}`} i={i} s={s} tint="#02050f" fill={k * 0.55} edge={0} />);
      continue;
    }
    if (isWin) {
      shapes.push(<ClaimShape key={`win${i}`} i={i} s={s} tint="#ffcf4a" fill={0.22 + 0.16 * Math.sin(now / 140)} edge={1} />);
      continue;
    }
    if (el < 0 && Boolean(pendMask & (1 << i))) {
      shapes.push(<ClaimShape key={`dug${i}`} i={i} s={s} tint="#ffd84a" fill={0.30} edge={1} />);
    } else if (el < 0 && st.selected.includes(i)) {
      shapes.push(<ClaimShape key={`sel${i}`} i={i} s={s} tint="#5ceeff" fill={0.44} edge={1} />);
    }
  }

  // ---- build the scene, depth-sorted by where things stand ----
  const items: Item[] = [];
  const solo = soloMask(st.roundId);
  for (let i = 0; i < BLOCKS; i++) {
    const c = CLAIMS[i];
    const isWin = winner === i && el >= 2500;
    const lift = isWin ? 3 + Math.abs(Math.sin(now / 160)) * 2 : st.selected.includes(i) ? 1 : 0;
    const ix = c.cx - ICON_ANCHOR[0];
    const iy = c.cy - ICON_ANCHOR[1] - lift;
    const hitAge = now - (fx.hits.get(i) ?? 0);
    const flash = Math.floor(now / 300) % 2;
    const [iw, ih] = ISLE.icon;
    items.push({
      z: c.cy,
      key: `claim${i}`,
      node: (
        <View key={`claim${i}`} pointerEvents="none">
          <Sprite name={`claim-icon-${c.kind}` as SpriteName} x={ix} y={iy} w={iw} h={ih} s={s} />
          {Boolean(pendMask & (1 << i)) ? <Sprite name={`flag-${flash}` as SpriteName} x={c.cx + 4} y={c.cy - 24} w={14} h={16} s={s} /> : null}
          {hitAge < 350 ? <Sprite name={`dust-${Math.min(2, Math.floor(hitAge / 117))}` as SpriteName} x={c.cx - 10} y={c.cy - 2} w={20} h={12} s={s} /> : null}
          {isWin ? <Sprite name={`sparkle-${Math.floor(now / 110) % 3}` as SpriteName} x={c.cx - 14} y={c.cy - 22} w={28} h={36} s={s} /> : null}
        </View>
      ),
    });
    if (mo.idx === i) {
      const age = now - mo.start;
      const bonked = mo.bonkedAt > 0;
      const mf = bonked ? 3 : age < 120 ? 0 : age < 240 ? 1 : age > UP - 120 ? 0 : age > UP - 240 ? 1 : 2;
      items.push({
        z: c.cy + 0.5,
        key: 'mole',
        node: <Sprite key="mole" name={`mole-${mf}` as SpriteName} x={c.cx - 18} y={c.cy - 8} w={16} h={16} s={s} />,
      });
    }
  }
  const mx = m.x;
  const my = m.y + jump;
  items.push({
    z: m.y + MNH,
    key: 'miner',
    node: (
      <View key="miner" pointerEvents="none">
        <MinerSprite x={mx} y={my} s={s} facing={m.facing} pose={pose} frame={frame} look={{ hat: hat.color, fit: fit.color, pick: pick.accent }} />
        <Tag x={mx} y={my} s={s} text="You" tone="me" emoji={emoteOf(world.me)} />
      </View>
    ),
  });
  if (pet) items.push({ z: pref.current.y + 12, key: 'pet', node: <PetSprite key="pet" x={pref.current.x} y={pref.current.y} s={s} tint={pet.color} now={now} /> });
  const near = (p: Avatar) => Math.hypot(p.x - m.x, p.y - m.y) < 28;
  for (const p of peers) {
    const pf = frameFor(p.pose, now, p.id.length * 97);
    items.push({
      z: p.y + MNH,
      key: `peer-${p.id}`,
      node: (
        <View key={`peer-${p.id}`} pointerEvents="none">
          <MinerSprite x={p.x} y={p.y} s={s} facing={p.facing} pose={p.pose} frame={pf} look={p} />
          <Tag
            x={p.x}
            y={p.y}
            s={s}
            text={`${p.name}${near(p) ? ' · tap' : ''}`}
            tone={p.bot ? 'bot' : p.wallet ? 'verified' : 'guest'}
            emoji={emoteOf(p.id)}
          />
        </View>
      ),
    });
    if (p.pet) items.push({ z: p.y + MNH + 10, key: `peerpet-${p.id}`, node: <PetSprite key={`peerpet-${p.id}`} x={p.x - 11 * p.facing} y={p.y + 12} s={s} tint={p.pet} now={now} /> });
  }
  items.sort((a, b) => a.z - b.z);

  // ---- the sea: ships on a slow circuit, birds drifting over ----
  const [shw, shh] = ISLE.ship;
  const sea: ReactNode[] = SHIPS.map((sh, k) => {
    const [x, y, dir] = shipAt(sh.path, sh.from + (now / 1000) * sh.speed);
    const bob = Math.sin(now / 420 + k * 2) > 0 ? 0 : 1;
    return (
      <Sprite
        key={`ship${k}`}
        name={`ship-${sh.kind}` as SpriteName}
        x={x - SHIP_ANCHOR[0]}
        y={y - SHIP_ANCHOR[1] + bob}
        w={shw}
        h={shh}
        s={s}
        flip={dir < 0}
      />
    );
  });
  const [bw, bh] = ISLE.bird;
  const birds: ReactNode[] = [];
  for (const f of FLOCKS) {
    f.x += f.sp * f.dir * dt * 6;
    if (f.x > MAP_W + 30) f.x = -30;
    if (f.x < -30) f.x = MAP_W + 30;
    for (let b = 0; b < f.n; b++) {
      const bx = f.x - f.dir * b * 9;
      const by = f.y + Math.sin(now / 700 + b) * 3 + b * 4;
      const up = Math.sin(now / 160 + b * 1.7) > 0;
      birds.push(
        <Sprite key={`bird${f.x.toFixed(0)}-${b}`} name={up ? 'bird-0' : 'bird-1'} x={bx - BIRD_ANCHOR[0]} y={by - BIRD_ANCHOR[1]} w={bw} h={bh} s={s} opacity={0.9} />,
      );
    }
  }

  // ---- effects on top ----
  const top_: ReactNode[] = [];
  if (winner !== null && winner !== undefined && el >= 2500) {
    const c = CLAIMS[winner];
    const k = Math.min(1, (el - 2500) / 300);
    top_.push(<Sprite key="beam" name="beam" x={c.cx - 10} y={c.cy - 70} w={20} h={70} s={s} opacity={0.85 * k} />);
  }
  if (el >= 0 && cave) {
    for (let k = 0; k < 14; k++) {
      const t = Math.max(0, el / 1000 - seeded(k + 400) * 1.2);
      const tx = MAP_W * 0.15 + seeded(k + 200) * MAP_W * 0.7;
      const ty = MAP_H * 0.25 + seeded(k + 300) * MAP_H * 0.55;
      const y = Math.min(ty, -MAP_H * 0.1 + MAP_H * 0.9 * t * t);
      top_.push(<Sprite key={`rock${k}`} name="rock" x={tx - 4} y={y} w={8} h={8} s={s} opacity={t > 0 ? 1 : 0} />);
    }
  }

  // ---- the SOL on each claim ----
  // The region names are painted into the island itself; drawn here they fought
  // the amount chips for the same pixels and both lost.
  const fs = Math.max(7, 5.2 * s);
  const potNow = st.pot.roundId === st.roundId ? st.pot : null;
  const amounts: ReactNode[] = [];
  if (el < 0 || el < 2500)
    for (let i = 0; i < BLOCKS; i++) {
      const c = CLAIMS[i];
      const v = potNow?.perBlock[i] ?? 0;
      const mine = Boolean(pendMask & (1 << i));
      amounts.push(
        <View
          key={`amt${i}`}
          pointerEvents="none"
          style={[CLAIM_AMT, { left: (c.cx - 11) * s, top: (c.cy + 5) * s, width: 22 * s, borderColor: mine ? '#ffd84a' : '#2a4480' }]}
        >
          <Text numberOfLines={1} style={{ color: v > 0 ? (mine ? '#ffd84a' : '#bfe9ff') : '#6f82b0', fontFamily: F.display, fontSize: fs, lineHeight: fs * 1.15 }}>
            {fmtAmt(v)}
          </Text>
        </View>,
      );
      if (solo & (1 << i) && !(el >= 1400 && winner !== null && winner !== i))
        amounts.push(
          <Text key={`solo${i}`} style={[SOLO_STAR, { left: (c.cx + 5) * s, top: (c.cy - 20) * s, fontSize: 7 * s, lineHeight: 8 * s }]}>
            ★
          </Text>,
        );
    }

  // ---- taps ----
  // One surface over the whole island: the claim shapes are irregular, so the
  // grid decides what was hit rather than a rectangle per claim.
  const taps: ReactNode[] = [
    <Pressable
      key="ground"
      accessibilityLabel="The island: tap a claim to pick it, or open ground to walk there"
      onPress={(e) => {
        // locationX isn't always filled in on web; fall back to the page position minus the map's offset
        const ne = e.nativeEvent as { locationX?: number; locationY?: number; pageX?: number; pageY?: number };
        const lx = (Number.isFinite(ne.locationX) ? (ne.locationX as number) : (ne.pageX ?? 0) - left) / s;
        const ly = (Number.isFinite(ne.locationY) ? (ne.locationY as number) : (ne.pageY ?? 0) - topPx) / s;
        if (!Number.isFinite(lx) || !Number.isFinite(ly)) return;
        const hit = claimForTap(lx, ly);
        if (hit >= 0 && el < 0) {
          if (mo.idx === hit && mo.bonkedAt < 0) {
            mo.bonkedAt = Date.now();
            useGame.getState().bonkMole();
            return;
          }
          toggle(hit);
          return;
        }
        const [gx, gy] = toLand(lx, ly);
        const [tx, ty] = fromFoot(gx, gy);
        manualUntil.current = Date.now() + 8000;
        m.tx = Math.max(2, Math.min(MAP_W - MNW - 2, tx));
        m.ty = Math.max(2, Math.min(MAP_H - MNH - 2, ty));
        m.target = -1;
        m.mode = 'walk';
        m.since = Date.now();
      }}
      style={{ position: 'absolute', left: 0, top: 0, width: MAP_W * s, height: MAP_H * s }}
    />,
  ];
  for (const p of peers)
    taps.push(
      <Pressable
        key={`tapPeer-${p.id}`}
        accessibilityLabel={`Meet ${p.name}`}
        onPress={() => useWorld.getState().setFocus(p.id)}
        style={{ position: 'absolute', left: p.x * s, top: p.y * s, width: MNW * s, height: MNH * s }}
      />,
    );
  taps.push(
    <Pressable
      key="tapMiner"
      accessibilityLabel="Cheer with your miner"
      onPress={() => useGame.getState().doEmote()}
      style={{ position: 'absolute', left: mx * s, top: my * s, width: MNW * s, height: MNH * s }}
    />,
  );

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: SEA, overflow: 'hidden' }]} {...({ dataSet: { pixel: '1' } } as object)}>
      <View style={{ position: 'absolute', left: left + shake * s, top: topPx, width: MAP_W * s, height: MAP_H * s }}>
        <Image source={SPRITES.island} style={{ position: 'absolute', left: 0, top: 0, width: MAP_W * s, height: MAP_H * s }} fadeDuration={0} />
        {sea}
        {shapes}
        {items.map((it) => it.node)}
        {amounts}
        {top_}
        {birds}
        {taps}
      </View>
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
