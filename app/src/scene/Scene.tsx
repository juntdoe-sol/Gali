import { Canvas, useFrame, useThree } from '@react-three/fiber/native';
import { Outlines, RoundedBox, Sparkles } from '@react-three/drei/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { BLOCKS, CAVE_IN_EVERY } from '../game/constants';
import { useGame } from '../game/store';
import { play } from '../game/sfx';
import { blockPos, fx, isDug, revealEl } from './fx';
import { INK, Toon, toonRamp } from './toon';
import { MineCart, Miner, Mole } from './Characters';

const DIRT = ['#b0714a', '#a3683f', '#b97d52', '#9c6343', '#aa6f4b'];
const GOLD = new THREE.Color('#ffc83d');
const DIM = new THREE.Color('#3a2a33');
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
  const dust = useRef<THREE.Group>(null);
  const marker = useRef<THREE.Mesh>(null);
  const selected = useGame((s) => s.selected.includes(i));
  const dug = useGame((s) => Boolean(s.pending && s.pending.mask & (1 << i)));
  const isWinner = useGame((s) => s.phase === 'reveal' && s.winning === i);
  const toggle = useGame((s) => s.toggleBlock);
  const base = useMemo(() => new THREE.Color(DIRT[(i * 7) % DIRT.length]), [i]);
  const tmp = useMemo(() => new THREE.Color(), []);
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
      } else {
        const k = THREE.MathUtils.clamp((el - 2500) / 350, 0, 1);
        ty = 0.75 * k + Math.sin(t * 6) * 0.05 * k;
        rotY = k * Math.max(0, el - 2500) * 0.004;
        tmp.lerp(GOLD, Math.max(k, ((el - 1400) / 1100) * 0.4));
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
    m.emissiveIntensity = THREE.MathUtils.lerp(m.emissiveIntensity, emissive + hitK * 0.3, 0.25);
    if (marker.current) {
      marker.current.rotation.y = t * 2;
      marker.current.position.y = 0.52 + Math.sin(t * 3 + i) * 0.04;
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
    <group ref={ref} position={[x, 0, z]}>
      <RoundedBox
        args={[0.94, 0.62, 0.94]}
        radius={0.14}
        smoothness={2}
        castShadow
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          if (fx.moleBlock === i) return;
          pressAt.current = nowS();
          toggle(i);
        }}
      >
        <meshToonMaterial ref={mat} color={base} gradientMap={toonRamp} emissive="#ffb020" emissiveIntensity={0} />
        <Outlines thickness={0.025} color={selected ? '#ffe08a' : INK} />
      </RoundedBox>
      {[0, 1, 2].map((k) => (
        <mesh key={k} position={[(seeded(i * 3 + k) - 0.5) * 0.55, 0.32, (seeded(i * 5 + k) - 0.5) * 0.55]} scale={[1, 0.5, 1]}>
          <sphereGeometry args={[0.045 + seeded(i + k) * 0.03, 6, 5]} />
          <Toon c="#7a4e34" />
        </mesh>
      ))}
      {dug && (
        <mesh ref={marker} position={[0, 0.52, 0]} scale={[1, 1.6, 1]}>
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
    </group>
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

function Cave() {
  const rocks = useMemo(
    () =>
      Array.from({ length: 22 }, (_, k) => {
        const a = (k / 22) * Math.PI * 2;
        const r = 5.4 + seeded(k) * 1.6;
        return { p: [Math.cos(a) * r, -0.1 + seeded(k + 3) * 0.5, Math.sin(a) * r] as [number, number, number], s: 0.6 + seeded(k + 9) * 0.9, c: ['#5b4059', '#4c3550', '#634661'][k % 3] };
      }),
    [],
  );
  const crystals = useMemo(
    () =>
      Array.from({ length: 12 }, (_, k) => {
        const a = (k / 12) * Math.PI * 2 + 0.3;
        const r = 4.1 + (k % 3) * 0.4;
        return { p: [Math.cos(a) * r, 0.2, Math.sin(a) * r] as [number, number, number], c: ['#ff6b9a', '#3de0c8', '#b86bff'][k % 3], s: 0.22 + (k % 4) * 0.07 };
      }),
    [],
  );
  const cg = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (cg.current) cg.current.children.forEach((c, k) => (c.position.y = 0.25 + Math.sin(state.clock.elapsedTime * 1.2 + k) * 0.06));
  });
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} receiveShadow>
        <circleGeometry args={[10, 40]} />
        <Toon c="#3b2638" />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.31, 0]} receiveShadow>
        <circleGeometry args={[3.7, 40]} />
        <Toon c="#4d3242" />
      </mesh>
      {[-0.18, 0.18].map((o) => (
        <mesh key={o} position={[3.2, -0.29, -0.55 + o]} rotation={[0, -0.5, 0]}>
          <boxGeometry args={[2.4, 0.03, 0.04]} />
          <Toon c="#9aa4b8" />
        </mesh>
      ))}
      {rocks.map((r, k) => (
        <mesh key={k} position={r.p} scale={r.s} rotation={[k, k * 2, 0]}>
          <dodecahedronGeometry args={[0.7, 0]} />
          <Toon c={r.c} />
          <Outlines thickness={0.03} color={INK} />
        </mesh>
      ))}
      <group ref={cg}>
        {crystals.map((c, k) => (
          <mesh key={k} position={c.p} scale={[c.s, c.s * 2, c.s]}>
            <octahedronGeometry args={[0.5, 0]} />
            <Toon c={c.c} e={c.c} ei={0.8} />
          </mesh>
        ))}
      </group>
      {[-1, 1].map((sd) => (
        <group key={sd} position={[sd * 3.4, -0.3, -3.3]}>
          <mesh position={[0, 1.3, 0]}>
            <boxGeometry args={[0.25, 2.6, 0.25]} />
            <Toon c="#6b4a32" />
            <Outlines thickness={0.02} color={INK} />
          </mesh>
          <mesh position={[0, 1.6, 0.22]}>
            <sphereGeometry args={[0.12, 10, 8]} />
            <Toon c="#ffb86b" e="#ffb86b" ei={1.5} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, 2.5, -3.3]}>
        <boxGeometry args={[7.2, 0.3, 0.25]} />
        <Toon c="#6b4a32" />
        <Outlines thickness={0.02} color={INK} />
      </mesh>
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

function Rig({ tilt }: { tilt: { x: number; y: number } }) {
  const { camera, size } = useThree();
  const look = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const cam = camera as THREE.PerspectiveCamera;
    const aspect = size.width / size.height;
    fx.narrow = aspect < 0.8;
    const dist = aspect < 0.5 ? 23 : aspect < 0.8 ? 20 : 13;
    const el = revealEl();
    let shake = 0;
    let punch = 0;
    if (el >= 0 && el < 1400) shake = 0.05 * Math.min(1, el / 900);
    if (el > 2500 && el < 2900) {
      shake = 0.1;
      punch = 1 - (el - 2500) / 400;
    }
    const t = state.clock.elapsedTime;
    target.set(tilt.x * 0.8 + Math.sin(t * 0.2) * 0.2, dist * 0.84 + tilt.y * 0.5, dist * 0.52);
    if (cam.position.distanceTo(target) > 4) cam.position.copy(target);
    else cam.position.lerp(target, 0.08);
    cam.position.x += (Math.random() - 0.5) * shake;
    cam.position.y += (Math.random() - 0.5) * shake;
    const fov = THREE.MathUtils.lerp(cam.fov, 40 - punch * 3, 0.2);
    if (Math.abs(fov - cam.fov) > 0.001) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    look.set(0, 0, fx.narrow ? 1.1 : 0.4);
    cam.lookAt(look);
  });
  return null;
}

function Lights() {
  const light = useRef<THREE.HemisphereLight>(null);
  const tint = useMemo(() => new THREE.Color(), []);
  useFrame(() => {
    const cave = useGame.getState().roundId % CAVE_IN_EVERY === 0;
    if (light.current) light.current.color.lerp(tint.set(cave ? '#ff9a8a' : '#d9c8ff'), 0.05);
  });
  return (
    <>
      <hemisphereLight ref={light} args={['#d9c8ff', '#3b2638', 1.25]} />
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
      <pointLight position={[0, 2.5, 0]} intensity={4} distance={8} color="#ffb86b" />
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
      <color attach="background" args={['#1b1426']} />
      <fog attach="fog" args={['#1b1426', 18, 34]} />
      <Lights />
      <Rig tilt={tilt} />
      <RevealSounds />
      <Cave />
      {Array.from({ length: BLOCKS }, (_, i) => (
        <Block key={i} i={i} />
      ))}
      <Miner />
      <Mole />
      <MineCart />
      <FallingRocks />
      <Sparkles count={50} scale={[10, 4, 10]} position={[0, 1.5, 0]} size={3} speed={0.3} color="#ffd98a" opacity={0.6} />
    </Canvas>
  );
}
