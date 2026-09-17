import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { Outlines, RoundedBox } from '@react-three/drei/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BLOCKS, CAVE_IN_EVERY } from '../game/constants';
import { useGame } from '../game/store';
import { play } from '../game/sfx';
import { blockPos, fx, isDug, revealEl } from './fx';
import { INK, Toon, toonRamp } from './toon';
import { Miner, Mole } from './Characters';
import { Site, SITE_TOPS, siteKind } from './Sites';

const DIRT = ['#6b4429', '#633f26', '#71492d', '#5e3c25', '#68432a'];
const GOLD = new THREE.Color('#ffc83d');
const DIM = new THREE.Color('#4a3526');
const SELECT = new THREE.Color('#ffe08a');
const DUG = new THREE.Color('#c7f284');

const seeded = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const nowS = () => performance.now() / 1000;

function Block({ i }: { i: number }) {
  const ref = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshToonMaterial>(null);
  const side = useRef<THREE.MeshToonMaterial>(null);
  const dust = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Mesh>(null);
  const selected = useGame((s) => s.selected.includes(i));
  const dug = useGame((s) => Boolean(s.pending && s.pending.mask & (1 << i)));
  const isWinner = useGame((s) => s.phase === 'reveal' && s.winning === i);
  const toggle = useGame((s) => s.toggleBlock);
  const base = useMemo(() => new THREE.Color(SITE_TOPS[siteKind(i) % SITE_TOPS.length]), [i]);
  const dirt = useMemo(() => new THREE.Color(DIRT[(i * 7) % DIRT.length]), [i]);
  const tmp = useMemo(() => new THREE.Color(), []);
  const tmpSide = useMemo(() => new THREE.Color(), []);
  const [x, , z] = blockPos(i);
  const pressAt = useRef(-10);

  useFrame((state) => {
    const g = ref.current;
    const m = mat.current;
    if (!g || !m) return;
    const t = state.clock.elapsedTime;
    const st = useGame.getState();
    const el = revealEl();
    let ty = 0;
    let rotY = 0;
    let shakeX = 0;
    let emissive = 0;
    tmp.copy(base);
    let dimK = 0;
    let goldK = 0;
    const win = st.phase === 'reveal' && st.winning === i;
    if (el >= 0) {
      if (el < 1400) {
        shakeX = Math.sin(t * 60 + i) * 0.035 * Math.min(1, el / 900);
        if (isDug(i)) tmp.lerp(DUG, 0.35);
      } else if (!win) {
        const order = (i * 11) % BLOCKS;
        const k = THREE.MathUtils.clamp((el - 1400 - order * 40) / 300, 0, 1);
        ty = -0.3 * k;
        tmp.lerp(DIM, k * 0.75);
        dimK = k * 0.75;
      } else {
        const k = THREE.MathUtils.clamp((el - 2500) / 350, 0, 1);
        ty = 0.75 * k + Math.sin(t * 6) * 0.05 * k;
        rotY = k * Math.max(0, el - 2500) * 0.004;
        goldK = Math.max(k, ((el - 1400) / 1100) * 0.4);
        tmp.lerp(GOLD, goldK);
        emissive = 0.7 * k;
      }
    } else if (selected) {
      ty = 0.14 + Math.sin(t * 5 + i) * 0.03;
      tmp.lerp(SELECT, 0.45);
      emissive = 0.2;
    } else if (isDug(i)) {
      tmp.lerp(DUG, 0.3);
      emissive = 0.08;
    }
    const hitAt = fx.hits.get(i);
    const since = hitAt ? (performance.now() - hitAt) / 1000 : 9;
    const hitK = Math.max(0, 1 - since / 0.22);
    const pressK = Math.max(0, 1 - (nowS() - pressAt.current) / 0.2);
    const sq = 1 - hitK * 0.14 - pressK * 0.1;
    g.scale.set(1 + (1 - sq) * 0.5, sq, 1 + (1 - sq) * 0.5);
    g.position.y = THREE.MathUtils.lerp(g.position.y, ty, 0.2);
    g.position.x = x + shakeX;
    g.rotation.y = win ? rotY : THREE.MathUtils.lerp(g.rotation.y, 0, 0.2);
    m.color.lerp(tmp, 0.25);
    if (side.current) side.current.color.lerp(tmpSide.copy(dirt).lerp(DIM, dimK).lerp(GOLD, goldK * 0.6), 0.25);
    m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, emissive + hitK * 0.3, 0.25);
    if (marker.current) {
      marker.current.rotation.y = t * 2;
      marker.current.position.y = 1.0 + Math.sin(t * 3 + i) * 0.04;
    }

    const d = dust.current;
    if (d) {
      const dk = since < 0.6 ? since / 0.6 : 1;
      d.visible = dk < 1;
      if (dk < 1)
        d.children.forEach((c, n) => {
          const a = (n / d.children.length) * Math.PI * 2;
          c.position.set(Math.cos(a) * (0.2 + dk * 0.45), 0.35 + dk * 0.25, Math.sin(a) * (0.2 + dk * 0.45));
          c.scale.setScalar((1 - dk) * 1.2);
        });
    }
  });

  return (
    <group
      ref={ref}
      position={[x, 0, z]}
      onClick={(e) => {
        e.stopPropagation();
        if (fx.moleBlock === i) return;
        pressAt.current = nowS();
        toggle(i);
      }}
    >
      <RoundedBox args={[0.94, 0.56, 0.94]} position={[0, -0.03, 0]} radius={0.1} smoothness={3} castShadow receiveShadow>
        <meshToonMaterial ref={side} color={dirt} gradientMap={toonRamp} />
        <Outlines thickness={0.025} color={selected ? '#3ee6ff' : INK} />
      </RoundedBox>
      <RoundedBox args={[0.98, 0.08, 0.98]} position={[0, 0.27, 0]} radius={0.035} smoothness={2} receiveShadow>
        <meshToonMaterial ref={mat} color={base} gradientMap={toonRamp} emissive="#ffb020" emissiveIntensity={0} />
      </RoundedBox>
      <mesh position={[0, 0.1, 0.472]}>
        <boxGeometry args={[0.8, 0.03, 0.01]} />
        <Toon c="#5c3a26" />
      </mesh>
      <group position={[0, 0.31, 0]}>
        <Site i={i} />
      </group>
      {selected ? <SelectRing /> : null}
      {dug && (
        <mesh ref={marker} position={[0, 1.0, 0]} scale={[1, 1.6, 1]}>
          <octahedronGeometry args={[0.12, 0]} />
          <Toon c="#c7f284" e="#c7f284" ei={0.7} />
          <Outlines thickness={0.012} color={INK} />
        </mesh>
      )}
      <group ref={dust} visible={false}>
        {Array.from({ length: 6 }).map((_, k) => (
          <mesh key={k}>
            <sphereGeometry args={[0.07, 6, 5]} />
            <meshBasicMaterial color="#e8c9a8" transparent opacity={0.8} />
          </mesh>
        ))}
      </group>
      {isWinner && <Burst />}
      {isWinner && <Beam />}
    </group>
  );
}

function SelectRing() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const k = 1 + Math.sin(state.clock.elapsedTime * 5) * 0.06;
    m.scale.set(k, k, 1);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.55 + Math.sin(state.clock.elapsedTime * 5) * 0.2;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.28, 0]}>
      <ringGeometry args={[0.52, 0.64, 32]} />
      <meshBasicMaterial color="#3ee6ff" transparent opacity={0.6} blending={THREE.AdditiveBlending} depthWrite={false} />
    </mesh>
  );
}

function Beam() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const m = ref.current;
    if (!m) return;
    const el = revealEl();
    const k = el < 2500 ? 0 : Math.min(1, (el - 2500) / 300);
    m.visible = k > 0;
    m.scale.set(k * (1 + Math.sin(state.clock.elapsedTime * 12) * 0.05), 1, k);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.45 * k;
  });
  return (
    <mesh ref={ref} position={[0, 4, 0]} visible={false}>
      <cylinderGeometry args={[0.35, 0.55, 8, 20, 1, true]} />
      <meshBasicMaterial color="#ffd86b" transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function Burst() {
  const group = useRef<THREE.Group>(null);
  const start = useRef<number | null>(null);
  const parts = useMemo(
    () =>
      Array.from({ length: 36 }, (_, k) => ({
        v: new THREE.Vector3((seeded(k) - 0.5) * 5.5, 3 + seeded(k + 50) * 4, (seeded(k + 99) - 0.5) * 5.5),
        c: ['#ffc83d', '#3de0c8', '#ff6b9a', '#ffffff', '#c7f284'][k % 5],
        s: 0.06 + seeded(k + 7) * 0.09,
      })),
    [],
  );
  useFrame((state) => {
    const el = revealEl();
    const g = group.current;
    if (!g) return;
    if (el < 2550) {
      g.visible = false;
      return;
    }
    if (start.current === null) start.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - start.current;
    g.visible = true;
    g.children.forEach((c, k) => {
      const p = parts[k];
      c.position.set(p.v.x * t, 0.8 + p.v.y * t - 4.9 * t * t, p.v.z * t);
      c.rotation.set(t * 6, t * 4, 0);
      c.scale.setScalar(Math.max(0, 1 - t / 1.9));
    });
  });
  return (
    <group ref={group} visible={false}>
      {parts.map((p, k) => (
        <mesh key={k}>
          <octahedronGeometry args={[p.s, 0]} />
          <meshBasicMaterial color={p.c} />
        </mesh>
      ))}
    </group>
  );
}

// clean earth ground: one flat soil plane and a few pebbles and grass tufts well outside the board
function Cave() {
  const bits = useMemo(
    () =>
      Array.from({ length: 26 }, (_, k) => {
        const a = seeded(k + 500) * Math.PI * 2;
        const r = 4.4 + seeded(k + 600) * 5;
        return {
          p: [Math.cos(a) * r, -0.3, Math.sin(a) * r] as [number, number, number],
          s: 0.5 + seeded(k + 700) * 0.8,
          grass: k % 3 === 0,
          r: seeded(k + 800) * 3,
        };
      }),
    [],
  );
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <planeGeometry args={[80, 80]} />
        <meshToonMaterial color="#a57c52" gradientMap={toonRamp} />
      </mesh>
      {bits.map((b, k) =>
        b.grass ? (
          <group key={k} position={b.p} rotation={[0, b.r, 0]} scale={b.s}>
            {[-0.06, 0, 0.06].map((x, n) => (
              <mesh key={n} position={[x, 0.08, 0]} rotation={[0, 0, x * 4]}>
                <coneGeometry args={[0.035, 0.22, 4]} />
                <Toon c={n === 1 ? '#7fae4a' : '#6a9a3e'} />
              </mesh>
            ))}
          </group>
        ) : (
          <mesh key={k} position={b.p} rotation={[b.r, b.r * 2, 0]} scale={[b.s, b.s * 0.6, b.s]}>
            <dodecahedronGeometry args={[0.1, 0]} />
            <Toon c={k % 2 ? '#8a7a68' : '#7a6a5a'} />
          </mesh>
        ),
      )}
    </>
  );
}

function FallingRocks() {
  const g = useRef<THREE.Group>(null);
  const seeds = useMemo(() => Array.from({ length: 14 }, (_, k) => ({ x: (seeded(k + 200) - 0.5) * 6, z: (seeded(k + 300) - 0.5) * 6, d: seeded(k + 400) * 1.2 })), []);
  useFrame(() => {
    const st = useGame.getState();
    const el = revealEl();
    const active = el >= 0 && st.roundId % CAVE_IN_EVERY === 0;
    if (!g.current) return;
    g.current.visible = active;
    if (!active) return;
    g.current.children.forEach((c, k) => {
      const t = Math.max(0, el / 1000 - seeds[k].d);
      c.position.set(seeds[k].x, Math.max(-0.1, 8 - 9 * t * t), seeds[k].z);
      c.rotation.x = t * 5;
    });
  });
  return (
    <group ref={g} visible={false}>
      {seeds.map((_, k) => (
        <mesh key={k}>
          <dodecahedronGeometry args={[0.18, 0]} />
          <Toon c="#6b4a5a" />
        </mesh>
      ))}
    </group>
  );
}

// board corners (incl. the tallest props) the camera keeps inside the free band
const BOARD_PTS = [-2.75, 2.75].flatMap((x) => [-2.75, 2.75].flatMap((z) => [new THREE.Vector3(x, -0.3, z), new THREE.Vector3(x, 0.95, z)]));

function Rig({ tilt }: { tilt: { x: number; y: number } }) {
  const { camera, size } = useThree();
  const look = useMemo(() => new THREE.Vector3(0, 0, 0.35), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const pt = useMemo(() => new THREE.Vector3(), []);
  const dist = useRef(18);
  const offset = useRef(0);
  const frames = useRef(0);
  useFrame((state) => {
    const cam = camera as THREE.PerspectiveCamera;
    const W = size.width;
    const H = size.height;
    fx.narrow = W / H < 0.8;
    const top = Math.min(fx.viewTop, H * 0.45);
    const bottom = Math.min(fx.viewBottom, H * 0.5);
    const band = Math.max(120, H - top - bottom);
    const settle = frames.current++ < 30; // converge fast on the first frames, then glide

    const el = revealEl();
    let shake = 0;
    let punch = 0;
    if (el >= 0 && el < 1400) shake = 0.05 * Math.min(1, el / 900);
    if (el > 2500 && el < 2900) {
      shake = 0.1;
      punch = 1 - (el - 2500) / 400;
    }
    const t = state.clock.elapsedTime;
    const d = dist.current;
    target.set(tilt.x * 0.8 + Math.sin(t * 0.2) * 0.2, d * 0.84 + tilt.y * 0.5, d * 0.52);
    if (settle) cam.position.copy(target);
    else cam.position.lerp(target, 0.1);
    cam.position.x += (Math.random() - 0.5) * shake;
    cam.position.y += (Math.random() - 0.5) * shake;
    cam.fov = THREE.MathUtils.lerp(cam.fov, 40 - punch * 3, 0.2);
    cam.setViewOffset(W, H, 0, -offset.current, W, H);
    cam.updateProjectionMatrix();
    cam.lookAt(look);
    cam.updateMatrixWorld();

    // measure where the board lands on screen and nudge distance and offset toward a snug fit
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    for (const p of BOARD_PTS) {
      pt.copy(p).project(cam);
      const px = (pt.x + 1) * 0.5 * W;
      const py = (1 - pt.y) * 0.5 * H;
      minX = Math.min(minX, px);
      maxX = Math.max(maxX, px);
      minY = Math.min(minY, py);
      maxY = Math.max(maxY, py);
    }
    const need = Math.max((maxX - minX) / (W * 0.9), (maxY - minY) / (band * 0.86));
    if (Number.isFinite(need) && need > 0) {
      dist.current = THREE.MathUtils.clamp(d * Math.pow(need, settle ? 0.8 : 0.08), 7, 45);
      const miss = top + band / 2 - (minY + maxY) / 2;
      offset.current += miss * (settle ? 0.8 : 0.08);
    }
  });
  return null;
}

function Lights() {
  const light = useRef<THREE.HemisphereLight>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const cave = useGame.getState().roundId % CAVE_IN_EVERY === 0;
    if (light.current) light.current.color.lerp(tint.set(cave ? '#ff9a8a' : '#fff1dc'), 0.05);
  });
  return (
    <>
      <hemisphereLight ref={light} args={['#fff1dc', '#6b4a2e', 1.25]} />
      <directionalLight
        position={[4, 9, 5]}
        intensity={2.3}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-6}
        shadow-camera-right={6}
        shadow-camera-top={6}
        shadow-camera-bottom={-6}
      />
      <directionalLight position={[-5, 4, -7]} intensity={0.8} color="#ffe2b0" />
      <pointLight position={[0, 2.5, 0]} intensity={3.2} distance={8} color="#ffc98a" />
    </>
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

export default function Scene({ tilt }: { tilt: { x: number; y: number } }) {
  const [ready, setReady] = useState(false);
  return (
    <Canvas
      shadows
      style={{ flex: 1, opacity: ready ? 1 : 0 }}
      camera={{ fov: 40, position: [0, 18, 10] }}
      onCreated={() => setReady(true)}
    >
      <color attach="background" args={['#7d5c3c']} />
      <fog attach="fog" args={['#7d5c3c', 22, 44]} />
      <Lights />
      <Rig tilt={tilt} />
      <RevealSounds />
      <Cave />
      {Array.from({ length: BLOCKS }, (_, i) => (
        <Block key={i} i={i} />
      ))}
      <Miner />
      <Mole />
      <FallingRocks />
    </Canvas>
  );
}
