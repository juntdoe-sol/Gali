import { useFrame } from '@react-three/fiber/native';
import { Outlines, Sparkles } from '@react-three/drei/native';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { gearByKey, LOCK_MS } from '../game/constants';
import { roundEnd, useGame } from '../game/store';
import { play } from '../game/sfx';
import { BLOCK_TOP, blockPos, fx, revealEl } from './fx';
import { INK, Toon } from './toon';

const HOME_WIDE = new THREE.Vector3(-3.55, -0.3, 0.1);
const HOME_NARROW = new THREE.Vector3(-2.25, -0.3, 2.95);
const HOP_S = 0.45;
const CYCLE_S = 1.8;
const OUT = 0.022;

const ease = (x: number) => x * x * (3 - 2 * x);
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

type Mood = 'idle' | 'work' | 'nervous' | 'cheer' | 'sad' | 'dance';

/* ---------------- Miner ---------------- */
export function Miner() {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const legR = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Group>(null);
  const eyes = useRef<THREE.Group>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);

  const pickId = useGame((s) => s.save.pickaxe);
  const hatId = useGame((s) => s.save.helmet);
  const pick = gearByKey(pickId);
  const hat = gearByKey(hatId);
  const glow = pick.rarity !== 'common';

  const motion = useRef({
    from: HOME_WIDE.clone(),
    to: HOME_WIDE.clone(),
    start: -10,
    key: 'home',
    cycleStart: 0,
    targetIdx: -1,
    struck: [false, false],
    facing: 0.9,
    blinkAt: 2,
    landed: 0,
  });

  useFrame((state, dt) => {
    const g = root.current;
    if (!g) return;
    const m = motion.current;
    const st = useGame.getState();
    const t = state.clock.elapsedTime;
    const now = Date.now();
    const deployed: number[] = [];
    const mask = st.pending?.mask ?? 0;
    for (let i = 0; i < 25; i++) if (mask & (1 << i)) deployed.push(i);

    // ---- decide where to stand and what mood to be in
    let mood: Mood = 'idle';
    let key = fx.narrow ? 'homeN' : 'home';
    const HOME = fx.narrow ? HOME_NARROW : HOME_WIDE;
    let dest = HOME;
    const rEl = revealEl();
    const endsAt = roundEnd(st.roundId) - st.offsetMs;
    const sinceResult = now - st.resultAt;
    const lastWon = st.lastResult?.won ?? false;

    if (now - st.emote < 2200) mood = 'dance';
    else if (st.phase !== 'mining') {
      const hadStake = deployed.length > 0;
      if (hadStake && rEl > 2600 && st.winning !== null) {
        if (mask & (1 << st.winning)) {
          mood = 'cheer';
          key = `b${st.winning}`;
        } else mood = 'sad';
      } else if (hadStake) mood = 'nervous';
    } else if (deployed.length && endsAt - now > LOCK_MS * 0.3) {
      mood = 'work';
      if (t - m.cycleStart > CYCLE_S || !deployed.includes(m.targetIdx)) {
        const next = deployed[(deployed.indexOf(m.targetIdx) + 1) % deployed.length];
        m.targetIdx = next;
        m.cycleStart = t;
        m.struck = [false, false];
      }
      key = `b${m.targetIdx}`;
    } else if (sinceResult < 3200 && st.lastResult) {
      mood = lastWon ? 'cheer' : 'sad';
      key = m.key; // stay where we are
    }

    if (key.startsWith('b')) {
      const [bx, , bz] = blockPos(Number(key.slice(1)));
      dest = new THREE.Vector3(bx, BLOCK_TOP - 0.02, bz);
    } else if (key.startsWith('home')) dest = HOME;
    else dest = m.to;

    if (key !== m.key) {
      m.from.copy(g.position);
      m.to.copy(dest);
      m.start = t;
      m.key = key;
      if (mood === 'work') m.cycleStart = t;
    }

    // ---- hop between spots
    const hk = Math.min(1, (t - m.start) / HOP_S);
    const dist = m.from.distanceTo(m.to);
    const pos = new THREE.Vector3().lerpVectors(m.from, m.to, ease(hk));
    pos.y += Math.sin(Math.PI * hk) * Math.min(1.2, 0.35 + dist * 0.18);
    const hopping = hk < 1;
    if (!hopping && m.landed < m.start) {
      m.landed = t;
      if (dist > 0.1) play('pop');
    }

    // ---- facing
    let face = m.facing;
    if (hopping && dist > 0.05) face = Math.atan2(m.to.x - m.from.x, m.to.z - m.from.z);
    else if (mood === 'work') face = -0.35; // three-quarter toward camera while swinging
    else if (mood === 'dance') face = t * 7;
    else if (mood === 'cheer' && sinceResult < 3200) face = wrapAngle(t * 3);
    else face = key.startsWith('home') ? (fx.narrow ? 0.4 : 0.9) : 0.2;
    m.facing = mood === 'dance' ? face : m.facing + wrapAngle(face - m.facing) * Math.min(1, dt * 10);
    g.rotation.y = m.facing;

    // ---- body bounce + squash
    const landK = Math.max(0, 1 - (t - m.landed) / 0.25);
    let bounce = 0;
    let squash = 1 - landK * 0.18;
    let armRx = -0.15;
    let armLx = 0.1;
    let armLz = 0.25;
    let legSwing = 0;
    let brow = 0; // + angry/focused, - worried
    let smile = 1;

    if (hopping) {
      armRx = -0.6;
      armLx = 0.6;
      legSwing = 0.6;
      squash = 1.08;
    } else if (mood === 'work') {
      const w = ((t - m.cycleStart - HOP_S) % 0.55) / 0.55;
      const inSwing = t - m.cycleStart > HOP_S;
      if (inSwing) {
        // windup 0-0.55, strike 0.55-0.7, recover
        armRx = w < 0.55 ? THREE.MathUtils.lerp(-0.4, -3.5, ease(w / 0.55)) : w < 0.7 ? THREE.MathUtils.lerp(-3.5, -0.75, (w - 0.55) / 0.15) : -0.75;
        bounce = w > 0.55 && w < 0.75 ? -0.05 : 0;
        const swingIdx = Math.floor((t - m.cycleStart - HOP_S) / 0.55);
        if (w > 0.66 && swingIdx < 2 && !m.struck[swingIdx]) {
          m.struck[swingIdx] = true;
          fx.hits.set(m.targetIdx, performance.now());
          play('hit');
        }
      }
      armLx = -0.3;
      armLz = 0.5;
      brow = 0.35;
      smile = 0.4;
    } else if (mood === 'nervous') {
      bounce = Math.abs(Math.sin(t * 14)) * 0.05;
      armLx = -1.2 + Math.sin(t * 20) * 0.1;
      armRx = -0.3;
      brow = -0.4;
      smile = -0.2;
    } else if (mood === 'cheer') {
      bounce = Math.abs(Math.sin(t * 9)) * 0.45;
      armRx = -3 + Math.sin(t * 18) * 0.3;
      armLx = -3 + Math.cos(t * 18) * 0.3;
      armLz = 0.4;
      squash = 1 + Math.sin(t * 18) * 0.06;
      brow = -0.1;
      smile = 1.4;
    } else if (mood === 'sad') {
      bounce = -0.06;
      armRx = 0.15;
      armLx = 0.15;
      armLz = 0.05;
      brow = -0.6;
      smile = -1;
    } else if (mood === 'dance') {
      bounce = Math.abs(Math.sin(t * 10)) * 0.25;
      armRx = -2.2 + Math.sin(t * 10) * 0.8;
      armLx = -2.2 - Math.sin(t * 10) * 0.8;
      armLz = 0.8;
      legSwing = Math.sin(t * 10) * 0.5;
      smile = 1.3;
    } else {
      bounce = Math.sin(t * 2.2) * 0.02;
      armRx = -0.15 + Math.sin(t * 2.2) * 0.05;
      smile = 0.9;
    }

    g.position.set(pos.x, pos.y + Math.max(bounce, -0.08), pos.z);
    if (body.current) body.current.scale.set(1 / Math.sqrt(squash), squash, 1 / Math.sqrt(squash));
    const k = Math.min(1, dt * 18);
    if (armR.current) armR.current.rotation.x += (armRx - armR.current.rotation.x) * (mood === 'work' ? 1 : k);
    if (armL.current) {
      armL.current.rotation.x += (armLx - armL.current.rotation.x) * k;
      armL.current.rotation.z += (-armLz - armL.current.rotation.z) * k;
    }
    if (legR.current && legL.current) {
      const walk = hopping ? Math.sin(t * 18) * legSwing : legSwing;
      legR.current.rotation.x = walk;
      legL.current.rotation.x = -walk;
    }

    // ---- face
    if (t > m.blinkAt) m.blinkAt = t + 2.2 + Math.random() * 2.5;
    const blink = m.blinkAt - t > 2.05 ? 0.12 : 1;
    if (eyes.current) eyes.current.scale.y = blink;
    if (browL.current && browR.current) {
      browL.current.rotation.z = THREE.MathUtils.lerp(browL.current.rotation.z, -brow * 0.6, k);
      browR.current.rotation.z = THREE.MathUtils.lerp(browR.current.rotation.z, brow * 0.6, k);
      browL.current.position.y = browR.current.position.y = 0.2 + (brow < 0 ? 0.03 : 0);
    }
    if (mouth.current) {
      const s = THREE.MathUtils.lerp(mouth.current.scale.y, smile, k);
      mouth.current.scale.set(0.8 + Math.abs(s) * 0.2, s, 1);
    }
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.06 + Math.sin(t * 3) * 0.015;
  });

  return (
    <group ref={root} position={HOME_WIDE.toArray()}>
      <group ref={body} scale={1}>
        <group scale={0.78}>
          {/* boots + legs */}
          {[
            [legL, -0.17],
            [legR, 0.17],
          ].map(([ref, x]) => (
            <group key={String(x)} ref={ref as React.RefObject<THREE.Group>} position={[x as number, 0.42, 0]}>
              <mesh position={[0, -0.14, 0]} castShadow>
                <capsuleGeometry args={[0.12, 0.18, 4, 10]} />
                <Toon c="#2f5fd0" />
                <Outlines thickness={OUT} color={INK} />
              </mesh>
              <mesh position={[0, -0.34, 0.05]} castShadow>
                <boxGeometry args={[0.24, 0.14, 0.34]} />
                <Toon c="#5a3a24" />
                <Outlines thickness={OUT} color={INK} />
              </mesh>
            </group>
          ))}
          {/* torso: shirt + overalls */}
          <mesh position={[0, 0.86, 0]} castShadow>
            <sphereGeometry args={[0.42, 24, 18]} />
            <Toon c="#ff8a3d" />
            <Outlines thickness={OUT} color={INK} />
          </mesh>
          <mesh position={[0, 0.74, 0]} castShadow scale={[1, 0.85, 1]}>
            <sphereGeometry args={[0.44, 24, 18, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55]} />
            <Toon c="#2f5fd0" />
          </mesh>
          <mesh position={[0, 0.92, 0.33]} rotation={[-0.25, 0, 0]}>
            <boxGeometry args={[0.36, 0.28, 0.06]} />
            <Toon c="#2f5fd0" />
            <Outlines thickness={OUT} color={INK} />
          </mesh>
          {[-0.12, 0.12].map((x) => (
            <mesh key={x} position={[x, 1.02, 0.37]}>
              <sphereGeometry args={[0.035, 10, 8]} />
              <Toon c="#ffc83d" e="#ffc83d" ei={0.3} />
            </mesh>
          ))}
          <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.41, 0.035, 8, 32]} />
            <Toon c="#4a2f1c" />
          </mesh>
          <mesh position={[0, 0.62, 0.42]}>
            <boxGeometry args={[0.13, 0.1, 0.04]} />
            <Toon c="#ffc83d" e="#ffb020" ei={0.3} />
          </mesh>
          {/* backpack */}
          <mesh position={[0, 0.92, -0.38]} castShadow>
            <boxGeometry args={[0.42, 0.44, 0.2]} />
            <Toon c="#7a5236" />
            <Outlines thickness={OUT} color={INK} />
          </mesh>
          <mesh position={[0, 1.18, -0.38]} rotation={[0, 0, Math.PI / 2]}>
            <capsuleGeometry args={[0.07, 0.36, 4, 8]} />
            <Toon c="#c9a26b" />
          </mesh>

          {/* head */}
          <group position={[0, 1.58, 0.02]}>
            <mesh castShadow>
              <sphereGeometry args={[0.42, 28, 22]} />
              <Toon c="#f5c49c" />
              <Outlines thickness={OUT} color={INK} />
            </mesh>
            {[-0.41, 0.41].map((x) => (
              <mesh key={x} position={[x, -0.02, 0]} scale={[0.5, 1, 0.8]}>
                <sphereGeometry args={[0.1, 12, 10]} />
                <Toon c="#eeb48c" />
              </mesh>
            ))}
            {/* eyes */}
            <group ref={eyes} position={[0, 0.05, 0.36]}>
              {[-0.13, 0.13].map((x) => (
                <group key={x} position={[x, 0, 0]}>
                  <mesh scale={[0.85, 1.1, 0.5]}>
                    <sphereGeometry args={[0.085, 16, 12]} />
                    <meshBasicMaterial color="#ffffff" />
                  </mesh>
                  <mesh position={[0, -0.005, 0.035]}>
                    <sphereGeometry args={[0.05, 12, 10]} />
                    <meshBasicMaterial color={INK} />
                  </mesh>
                  <mesh position={[0.018, 0.022, 0.07]}>
                    <sphereGeometry args={[0.014, 8, 6]} />
                    <meshBasicMaterial color="#ffffff" />
                  </mesh>
                </group>
              ))}
            </group>
            {/* brows */}
            <mesh ref={browL} position={[-0.13, 0.2, 0.38]}>
              <boxGeometry args={[0.13, 0.03, 0.03]} />
              <meshBasicMaterial color="#4a2f1c" />
            </mesh>
            <mesh ref={browR} position={[0.13, 0.2, 0.38]}>
              <boxGeometry args={[0.13, 0.03, 0.03]} />
              <meshBasicMaterial color="#4a2f1c" />
            </mesh>
            {/* nose, cheeks, mustache, mouth */}
            <mesh position={[0, -0.06, 0.43]}>
              <sphereGeometry args={[0.075, 14, 12]} />
              <Toon c="#ee9f7e" />
            </mesh>
            {[-0.24, 0.24].map((x) => (
              <mesh key={x} position={[x, -0.1, 0.33]} rotation={[0, x * 1.6, 0]}>
                <circleGeometry args={[0.06, 16]} />
                <meshBasicMaterial color="#ff7f8f" transparent opacity={0.5} />
              </mesh>
            ))}
            {[-1, 1].map((sd) => (
              <mesh key={sd} position={[sd * 0.08, -0.15, 0.39]} rotation={[0, 0, sd * 1.2]}>
                <capsuleGeometry args={[0.035, 0.1, 4, 8]} />
                <Toon c="#4a2f1c" />
              </mesh>
            ))}
            <mesh ref={mouth} position={[0, -0.23, 0.37]} rotation={[0, 0, Math.PI]}>
              <torusGeometry args={[0.06, 0.016, 6, 16, Math.PI]} />
              <meshBasicMaterial color="#6b2a2a" />
            </mesh>

            {/* helmet */}
            {hat.key === 'hat-crown' ? (
              <group position={[0, 0.34, 0]}>
                <mesh castShadow>
                  <cylinderGeometry args={[0.3, 0.27, 0.22, 10, 1, true]} />
                  <meshToonMaterial color={hat.color} emissive={hat.color} emissiveIntensity={0.35} side={THREE.DoubleSide} />
                </mesh>
                {[0, 1, 2, 3, 4].map((k) => (
                  <mesh key={k} position={[Math.cos((k / 5) * Math.PI * 2) * 0.29, 0.16, Math.sin((k / 5) * Math.PI * 2) * 0.29]}>
                    <octahedronGeometry args={[0.06, 0]} />
                    <Toon c={hat.accent} e={hat.accent} ei={0.8} />
                  </mesh>
                ))}
              </group>
            ) : (
              <group position={[0, 0.12, 0]}>
                <mesh castShadow>
                  <sphereGeometry args={[0.46, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2]} />
                  <Toon c={hat.color} />
                  <Outlines thickness={OUT} color={INK} />
                </mesh>
                <mesh position={[0, 0.01, 0.06]} rotation={[-0.08, 0, 0]}>
                  <cylinderGeometry args={[0.52, 0.52, 0.04, 28]} />
                  <Toon c={hat.color} />
                  <Outlines thickness={OUT} color={INK} />
                </mesh>
                <mesh position={[0, 0.44, 0]} rotation={[0, 0, Math.PI / 2]}>
                  <capsuleGeometry args={[0.04, 0.5, 4, 8]} />
                  <Toon c={hat.color} />
                </mesh>
              </group>
            )}
            {/* lamp + beam */}
            <group position={[0, 0.3, 0.4]} rotation={[0.7, 0, 0]}>
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <cylinderGeometry args={[0.09, 0.07, 0.08, 16]} />
                <Toon c="#555" />
              </mesh>
              <mesh position={[0, 0, 0.045]}>
                <circleGeometry args={[0.07, 16]} />
                <meshBasicMaterial color={hat.accent} />
              </mesh>
              <mesh ref={beam} position={[0, 0, 0.8]} rotation={[-Math.PI / 2, 0, 0]}>
                <coneGeometry args={[0.35, 1.5, 20, 1, true]} />
                <meshBasicMaterial color="#fff2b0" transparent opacity={0.14} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
              </mesh>
              <pointLight position={[0, 0, 0.4]} intensity={2.5} distance={3.5} color="#fff2c0" />
            </group>
          </group>

          {/* left arm */}
          <group ref={armL} position={[-0.44, 1.02, 0]}>
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.1, 0.22, 4, 10]} />
              <Toon c="#ff8a3d" />
              <Outlines thickness={OUT} color={INK} />
            </mesh>
            <mesh position={[0, -0.44, 0]}>
              <sphereGeometry args={[0.12, 14, 12]} />
              <Toon c="#c98a3d" />
              <Outlines thickness={OUT} color={INK} />
            </mesh>
          </group>

          {/* right arm + pickaxe */}
          <group ref={armR} position={[0.44, 1.02, 0]}>
            <mesh position={[0, -0.2, 0]} castShadow>
              <capsuleGeometry args={[0.1, 0.22, 4, 10]} />
              <Toon c="#ff8a3d" />
              <Outlines thickness={OUT} color={INK} />
            </mesh>
            <mesh position={[0, -0.44, 0]}>
              <sphereGeometry args={[0.12, 14, 12]} />
              <Toon c="#c98a3d" />
              <Outlines thickness={OUT} color={INK} />
            </mesh>
            <group position={[0, -0.46, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <mesh position={[0, 0.35, 0]} castShadow>
                <cylinderGeometry args={[0.04, 0.045, 1.0, 10]} />
                <Toon c={pick.color} />
                <Outlines thickness={OUT} color={INK} />
              </mesh>
              {pick.key === 'pick-neon' ? (
                <group position={[0, 0.9, 0]}>
                  <mesh>
                    <cylinderGeometry args={[0.13, 0.13, 0.16, 14]} />
                    <Toon c="#2a2a44" />
                  </mesh>
                  <mesh position={[0, 0.26, 0]}>
                    <coneGeometry args={[0.12, 0.42, 12]} />
                    <Toon c={pick.accent} e={pick.accent} ei={1.3} />
                  </mesh>
                </group>
              ) : (
                <group position={[0, 0.86, 0]} rotation={[0, 0, 0]}>
                  <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <cylinderGeometry args={[0.06, 0.06, 0.5, 10]} />
                    <Toon c={pick.accent} e={pick.accent} ei={glow ? 0.5 : 0} />
                    <Outlines thickness={OUT} color={INK} />
                  </mesh>
                  {[-1, 1].map((sd) => (
                    <mesh key={sd} position={[0, -0.04, sd * 0.33]} rotation={[sd * (Math.PI / 2 + 0.35), 0, 0]}>
                      <coneGeometry args={[0.06, 0.24, 10]} />
                      <Toon c={pick.accent} e={pick.accent} ei={glow ? 0.5 : 0} />
                      <Outlines thickness={OUT} color={INK} />
                    </mesh>
                  ))}
                </group>
              )}
            </group>
          </group>
        </group>
      </group>
      {glow && <Sparkles count={pick.rarity === 'legendary' ? 24 : 10} scale={[1.4, 1.6, 1.4]} position={[0, 0.8, 0]} size={3.5} color={pick.accent} speed={0.7} />}
    </group>
  );
}

/* ---------------- Mole (whack it!) ---------------- */
export function Mole() {
  const g = useRef<THREE.Group>(null);
  const face = useRef<THREE.Group>(null);
  const stars = useRef<THREE.Group>(null);
  const bonk = useGame((s) => s.bonkMole);
  const s = useRef({ idx: -1, start: 0, nextAt: 4, bonkedAt: -1, lastT: 0 });
  const UP = 2.4;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const st = useGame.getState();
    const m = s.current;
    m.lastT = t;
    const grp = g.current;
    if (!grp) return;
    const mining = st.phase === 'mining' && roundEnd(st.roundId) - st.offsetMs - Date.now() > 5000;
    if (m.idx < 0) {
      grp.visible = false;
      fx.moleBlock = -1;
      if (mining && t > m.nextAt) {
        const pm = st.pending?.mask ?? 0;
        const free = [...Array(25).keys()].filter((i) => !(pm & (1 << i)) && !st.selected.includes(i));
        if (free.length) {
          m.idx = free[Math.floor(Math.random() * free.length)];
          m.start = t;
          m.bonkedAt = -1;
          play('pop');
        } else m.nextAt = t + 3;
      }
      return;
    }
    const el = t - m.start;
    const bonked = m.bonkedAt > 0;
    const out = bonked ? Math.max(0, 1 - (t - m.bonkedAt) / 0.5) : el < 0.25 ? el / 0.25 : el > UP - 0.25 ? Math.max(0, (UP - el) / 0.25) : 1;
    if ((!bonked && el > UP) || (bonked && t - m.bonkedAt > 0.6) || !mining) {
      m.idx = -1;
      m.nextAt = t + 5 + Math.random() * 6;
      grp.visible = false;
      return;
    }
    fx.moleBlock = m.idx;
    const [x, , z] = blockPos(m.idx);
    grp.visible = true;
    grp.position.set(x, BLOCK_TOP - 0.45 + out * 0.5, z);
    grp.scale.set(1, bonked ? 0.55 : 1, 1);
    grp.rotation.y = Math.sin(t * 3) * 0.3;
    if (face.current) face.current.rotation.z = bonked ? Math.sin(t * 30) * 0.2 : 0;
    if (stars.current) {
      stars.current.visible = bonked;
      stars.current.rotation.y = t * 6;
    }
  });

  return (
    <group ref={g} visible={false}>
      <group
        onClick={(e) => {
          e.stopPropagation();
          const m = s.current;
          if (m.idx < 0 || m.bonkedAt > 0) return;
          m.bonkedAt = m.lastT;
          bonk();
        }}
        onPointerOver={() => (document.body.style.cursor = 'pointer')}
        onPointerOut={() => (document.body.style.cursor = '')}
      >
        <group ref={face}>
          <mesh position={[0, 0.2, 0]} scale={[1, 1.15, 1]} castShadow>
            <sphereGeometry args={[0.26, 20, 16]} />
            <Toon c="#8a5a3c" />
            <Outlines thickness={0.018} color={INK} />
          </mesh>
          <mesh position={[0, 0.22, 0.22]} scale={[1, 0.8, 0.7]}>
            <sphereGeometry args={[0.15, 16, 12]} />
            <Toon c="#e6b98c" />
          </mesh>
          <mesh position={[0, 0.27, 0.34]}>
            <sphereGeometry args={[0.055, 12, 10]} />
            <Toon c="#ff7fa0" />
          </mesh>
          {[-0.09, 0.09].map((x) => (
            <mesh key={x} position={[x, 0.36, 0.22]}>
              <sphereGeometry args={[0.035, 10, 8]} />
              <meshBasicMaterial color={INK} />
            </mesh>
          ))}
          <mesh position={[0, 0.2, 0.31]}>
            <boxGeometry args={[0.07, 0.05, 0.02]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.44, 0]}>
            <sphereGeometry args={[0.2, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <Toon c="#ffc83d" />
            <Outlines thickness={0.018} color={INK} />
          </mesh>
          {[-0.2, 0.2].map((x) => (
            <mesh key={x} position={[x, 0.12, 0.18]}>
              <sphereGeometry args={[0.07, 10, 8]} />
              <Toon c="#e6b98c" />
            </mesh>
          ))}
        </group>
        <group ref={stars} position={[0, 0.72, 0]} visible={false}>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={[Math.cos((k / 3) * Math.PI * 2) * 0.25, 0, Math.sin((k / 3) * Math.PI * 2) * 0.25]}>
              <octahedronGeometry args={[0.06, 0]} />
              <meshBasicMaterial color="#ffe066" />
            </mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

/* ---------------- Motherlode cart ---------------- */
export function MineCart() {
  const gems = useRef<THREE.Group>(null);
  const digs = useGame((s) => s.save.digs);
  const count = Math.min(16, 3 + Math.floor(digs / 4));
  const spots = useMemo(
    () =>
      Array.from({ length: 16 }, (_, k) => ({
        p: [((k % 4) - 1.5) * 0.2, 0.6 + Math.floor(k / 4) * 0.09, ((Math.floor(k / 4) % 2) - 0.5) * 0.14 + (k % 3) * 0.04] as [number, number, number],
        c: ['#3de0c8', '#ff6b9a', '#b86bff', '#ffc83d'][k % 4],
      })),
    [],
  );
  useFrame((state) => {
    if (gems.current) gems.current.children.forEach((c, k) => (c.rotation.y = state.clock.elapsedTime * (0.5 + (k % 3) * 0.3)));
  });
  return (
    <group position={[3.75, -0.3, -0.9]} rotation={[0, -0.5, 0]}>
      <mesh position={[0, 0.34, 0]} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.62]} />
        <Toon c="#6b4a32" />
        <Outlines thickness={0.02} color={INK} />
      </mesh>
      {[
        [0, 0.33, 1.02, 0.04],
        [0, -0.33, 1.02, 0.04],
        [0.49, 0, 0.04, 0.7],
        [-0.49, 0, 0.04, 0.7],
      ].map(([x, z, w, d]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.56, z]}>
          <boxGeometry args={[w, 0.06, d]} />
          <Toon c="#9aa4b8" />
        </mesh>
      ))}
      {[
        [-0.3, 0.33],
        [0.3, 0.33],
        [-0.3, -0.33],
        [0.3, -0.33],
      ].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.12, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.12, 0.12, 0.06, 14]} />
          <Toon c="#2a2340" />
          <Outlines thickness={0.015} color={INK} />
        </mesh>
      ))}
      <group ref={gems}>
        {spots.map((g, k) => (
          <mesh key={k} position={g.p} visible={k < count}>
            <octahedronGeometry args={[0.1, 0]} />
            <Toon c={g.c} e={g.c} ei={0.7} />
          </mesh>
        ))}
      </group>
      <pointLight position={[0, 1.1, 0.3]} intensity={1.2} distance={2.2} color="#3de0c8" />
    </group>
  );
}
