// Mini mining-site dioramas that sit on top of each block (tile top is y = 0).
// Low-poly, no outlines on small parts, so 25 of them stay cheap on phones.
import { useFrame } from '@react-three/fiber/native';
import { useRef } from 'react';
import * as THREE from 'three';
import { Toon } from './toon';

export const SITE_TOPS = ['#6c7a52', '#5d6470', '#7d5a3c', '#4f5a44', '#6f6a5e', '#7a6048', '#57606e', '#6a7450'];

const COAL = '#2b2f3d';
const COAL2 = '#3a4052';
const YELLOW = '#ffc629';
const STEEL = '#9aa7bd';
const RED = '#d9483b';
const WOOD = '#8a5a36';

function Heap({ p, s = 1, c = COAL }: { p: [number, number, number]; s?: number; c?: string }) {
  return (
    <mesh position={p} scale={[s, s * 0.75, s]}>
      <dodecahedronGeometry args={[0.16, 0]} />
      <Toon c={c} />
    </mesh>
  );
}

function Box({ p, a, c, r }: { p: [number, number, number]; a: [number, number, number]; c: string; r?: [number, number, number] }) {
  return (
    <mesh position={p} rotation={r}>
      <boxGeometry args={a} />
      <Toon c={c} />
    </mesh>
  );
}

function Cyl({ p, a, c, r, e, ei }: { p: [number, number, number]; a: [number, number, number, number?]; c: string; r?: [number, number, number]; e?: string; ei?: number }) {
  return (
    <mesh position={p} rotation={r}>
      <cylinderGeometry args={[a[0], a[1], a[2], a[3] ?? 8]} />
      <Toon c={c} e={e} ei={ei} />
    </mesh>
  );
}

function Nugget({ p }: { p: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (ref.current) ref.current.rotation.y = st.clock.elapsedTime * 1.5;
  });
  return (
    <mesh ref={ref} position={p}>
      <octahedronGeometry args={[0.06, 0]} />
      <Toon c="#ffd23f" e="#ffb020" ei={0.8} />
    </mesh>
  );
}

function Pickaxe({ p, r = 0 }: { p: [number, number, number]; r?: number }) {
  return (
    <group position={p} rotation={[0, r, 0.5]}>
      <Box p={[0, 0, 0]} a={[0.025, 0.3, 0.025]} c={WOOD} />
      <Box p={[0, 0.14, 0]} a={[0.2, 0.03, 0.03]} c={STEEL} r={[0, 0, 0.15]} />
    </group>
  );
}

/** Coal heap with pickaxes and a gold nugget. */
function CoalHill() {
  return (
    <>
      <Heap p={[0, 0.1, 0]} s={1.9} />
      <Heap p={[0.18, 0.06, 0.15]} s={1.1} c={COAL2} />
      <Heap p={[-0.2, 0.05, 0.12]} s={0.9} c={COAL2} />
      <Pickaxe p={[0.22, 0.2, -0.16]} r={0.6} />
      <Pickaxe p={[-0.25, 0.16, -0.1]} r={-0.8} />
      <Nugget p={[0.02, 0.36, 0.05]} />
    </>
  );
}

/** Yellow excavator digging into coal. */
function Excavator() {
  const arm = useRef<THREE.Group>(null);
  useFrame((st) => {
    if (arm.current) arm.current.rotation.z = 0.5 + Math.sin(st.clock.elapsedTime * 1.4) * 0.18;
  });
  return (
    <>
      <Heap p={[-0.25, 0.1, -0.12]} s={1.6} />
      <group position={[0.12, 0, 0.08]} rotation={[0, -0.5, 0]}>
        <Box p={[0, 0.04, 0]} a={[0.34, 0.08, 0.26]} c="#3a3f4c" />
        <Box p={[0, 0.14, 0]} a={[0.26, 0.12, 0.22]} c={YELLOW} />
        <Box p={[0.05, 0.25, 0.04]} a={[0.12, 0.12, 0.12]} c={YELLOW} />
        <Box p={[0.11, 0.25, 0.04]} a={[0.01, 0.08, 0.09]} c="#9fe3ff" />
        <group ref={arm} position={[-0.1, 0.18, -0.02]} rotation={[0, 0, 0.5]}>
          <Box p={[-0.13, 0, 0]} a={[0.26, 0.04, 0.04]} c={YELLOW} />
          <Box p={[-0.27, -0.06, 0]} a={[0.06, 0.08, 0.08]} c="#50566a" />
        </group>
      </group>
    </>
  );
}

/** Dump truck loaded with coal. */
function DumpTruck() {
  return (
    <group rotation={[0, 0.5, 0]}>
      <Box p={[0.02, 0.07, 0]} a={[0.5, 0.06, 0.24]} c="#3a3f4c" />
      <Box p={[0.2, 0.15, 0]} a={[0.13, 0.13, 0.22]} c={YELLOW} />
      <Box p={[0.26, 0.17, 0]} a={[0.01, 0.07, 0.18]} c="#9fe3ff" />
      <Box p={[-0.06, 0.16, 0]} a={[0.3, 0.12, 0.24]} c="#ff9f1a" />
      <Heap p={[-0.06, 0.24, 0]} s={0.9} />
      {[-0.16, 0.02, 0.2].map((x) =>
        [-0.12, 0.12].map((z) => <Cyl key={`${x}${z}`} p={[x, 0.05, z]} a={[0.05, 0.05, 0.04, 10]} r={[Math.PI / 2, 0, 0]} c="#1c1f28" />),
      )}
      <Heap p={[-0.3, 0.05, -0.28]} s={0.8} />
    </group>
  );
}

/** Open pit with terraces and a tiny truck. */
function OpenPit() {
  return (
    <>
      <Cyl p={[0, 0.01, 0]} a={[0.36, 0.36, 0.02, 16]} c="#6b4a33" />
      <Cyl p={[0, 0.015, 0]} a={[0.27, 0.27, 0.02, 16]} c="#4d3526" />
      <Cyl p={[0, 0.02, 0]} a={[0.17, 0.17, 0.02, 16]} c="#1d1a22" />
      <Box p={[0.2, 0.06, 0.18]} a={[0.12, 0.06, 0.07]} c={YELLOW} r={[0, 0.7, 0]} />
      <Heap p={[-0.28, 0.07, 0.26]} s={1} />
      <Box p={[-0.26, 0.12, -0.26]} a={[0.03, 0.24, 0.03]} c={WOOD} />
      <Box p={[-0.26, 0.22, -0.2]} a={[0.02, 0.06, 0.1]} c={RED} />
    </>
  );
}

/** Rails with ore carts. */
function Rails() {
  return (
    <group rotation={[0, 0.2, 0]}>
      {[-0.06, 0.06].map((z) => (
        <Box key={z} p={[0, 0.015, z]} a={[0.86, 0.02, 0.02]} c={STEEL} />
      ))}
      {[-0.36, -0.24, -0.12, 0, 0.12, 0.24, 0.36].map((x) => (
        <Box key={x} p={[x, 0.008, 0]} a={[0.04, 0.015, 0.2]} c={WOOD} />
      ))}
      {[-0.16, 0.14].map((x) => (
        <group key={x} position={[x, 0.08, 0]}>
          <Box p={[0, 0, 0]} a={[0.2, 0.1, 0.16]} c={x < 0 ? '#8c4a2e' : '#6d3a24'} />
          <Heap p={[0, 0.07, 0]} s={0.6} />
        </group>
      ))}
      <Nugget p={[0.14, 0.22, 0]} />
    </group>
  );
}

/** Drilling rig tower. */
function DrillRig() {
  const bit = useRef<THREE.Mesh>(null);
  useFrame((st) => {
    if (bit.current) bit.current.rotation.y = st.clock.elapsedTime * 8;
  });
  return (
    <>
      <Box p={[0, 0.03, 0]} a={[0.36, 0.06, 0.36]} c="#50566a" />
      {[
        [-0.12, -0.12],
        [0.12, -0.12],
        [-0.12, 0.12],
        [0.12, 0.12],
      ].map(([x, z]) => (
        <Box key={`${x}${z}`} p={[x * 0.6, 0.28, z * 0.6]} a={[0.025, 0.5, 0.025]} c={YELLOW} r={[z * 0.5, 0, -x * 0.5]} />
      ))}
      <Box p={[0, 0.52, 0]} a={[0.1, 0.04, 0.1]} c={RED} />
      <mesh ref={bit} position={[0, 0.2, 0]}>
        <cylinderGeometry args={[0.03, 0.01, 0.3, 6]} />
        <Toon c={STEEL} />
      </mesh>
      <Heap p={[0.28, 0.05, 0.26]} s={0.8} />
      <Heap p={[-0.3, 0.05, 0.22]} s={0.7} />
    </>
  );
}

/** Small processing plant with smoking chimneys. */
function Factory() {
  const smoke = useRef<THREE.Group>(null);
  useFrame((st) => {
    const g = smoke.current;
    if (!g) return;
    g.children.forEach((c, k) => {
      const t = (st.clock.elapsedTime * 0.5 + k / g.children.length) % 1;
      c.position.y = 0.52 + t * 0.35;
      c.scale.setScalar(0.4 + t * 0.9);
    });
  });
  return (
    <>
      <Box p={[-0.05, 0.1, 0.05]} a={[0.38, 0.2, 0.26]} c={RED} />
      <Box p={[-0.05, 0.21, 0.05]} a={[0.4, 0.03, 0.28]} c="#5a2a24" />
      <Box p={[-0.05, 0.1, 0.185]} a={[0.08, 0.12, 0.01]} c="#2a1a18" />
      <Cyl p={[0.24, 0.25, -0.2]} a={[0.035, 0.045, 0.5]} c="#b8433a" />
      <Cyl p={[0.12, 0.2, -0.22]} a={[0.03, 0.04, 0.4]} c="#b8433a" />
      <group ref={smoke}>
        {[0, 1, 2].map((k) => (
          <mesh key={k} position={[0.24, 0.6, -0.2]}>
            <sphereGeometry args={[0.04, 6, 5]} />
            <meshBasicMaterial color="#c9d2e3" transparent opacity={0.55} />
          </mesh>
        ))}
      </group>
      <Heap p={[-0.28, 0.05, -0.24]} s={0.8} />
    </>
  );
}

/** Two miners hacking at a coal seam. */
function MinersAtWork() {
  const a = useRef<THREE.Group>(null);
  const b = useRef<THREE.Group>(null);
  useFrame((st) => {
    const t = st.clock.elapsedTime * 5;
    if (a.current) a.current.rotation.z = Math.sin(t) * 0.6;
    if (b.current) b.current.rotation.z = Math.sin(t + 1.6) * 0.6;
  });
  const miner = (x: number, z: number, arm: React.RefObject<THREE.Group | null>) => (
    <group position={[x, 0, z]}>
      <Box p={[0, 0.08, 0]} a={[0.07, 0.14, 0.05]} c="#6d7a8f" />
      <mesh position={[0, 0.19, 0]}>
        <sphereGeometry args={[0.035, 8, 6]} />
        <Toon c="#f1c29b" />
      </mesh>
      <mesh position={[0, 0.215, 0]}>
        <sphereGeometry args={[0.04, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <Toon c={YELLOW} />
      </mesh>
      <group ref={arm} position={[-0.04, 0.13, 0]}>
        <Box p={[-0.06, 0.02, 0]} a={[0.12, 0.015, 0.015]} c={WOOD} />
        <Box p={[-0.12, 0.02, 0]} a={[0.015, 0.07, 0.015]} c={STEEL} />
      </group>
    </group>
  );
  return (
    <>
      <Heap p={[-0.22, 0.12, -0.05]} s={2} />
      {miner(0.05, 0.08, a)}
      {miner(0.12, -0.14, b)}
      <Cyl p={[0.28, 0.04, 0.24]} a={[0.04, 0.035, 0.08]} c="#8c95a8" />
    </>
  );
}

/** Glowing crystal outcrop. */
function Crystals({ color }: { color: string }) {
  return (
    <>
      <Heap p={[0, 0.05, 0]} s={1.3} c="#3a4468" />
      {[
        [0, 0.2, 0, 1.2, 0],
        [0.13, 0.13, 0.08, 0.8, 0.5],
        [-0.12, 0.12, 0.1, 0.7, -0.5],
        [0.05, 0.1, -0.15, 0.6, 0.3],
      ].map(([x, y, z, s, r], k) => (
        <mesh key={k} position={[x, y, z]} rotation={[0, 0, r]} scale={[s, s * 2, s]}>
          <octahedronGeometry args={[0.07, 0]} />
          <Toon c={color} e={color} ei={0.7} />
        </mesh>
      ))}
    </>
  );
}

const CRYSTAL = ['#3ee6ff', '#ff5fa2', '#b98bff'];

export function siteKind(i: number) {
  // a fixed, hand-shuffled layout so neighbours differ
  return [0, 1, 2, 3, 4, 5, 6, 7, 8, 2, 4, 0, 8, 1, 3, 7, 5, 6, 3, 0, 1, 8, 6, 2, 5][i % 25];
}

export function Site({ i }: { i: number }) {
  switch (siteKind(i)) {
    case 0:
      return <CoalHill />;
    case 1:
      return <Excavator />;
    case 2:
      return <DumpTruck />;
    case 3:
      return <OpenPit />;
    case 4:
      return <Rails />;
    case 5:
      return <DrillRig />;
    case 6:
      return <Factory />;
    case 7:
      return <MinersAtWork />;
    default:
      return <Crystals color={CRYSTAL[i % 3]} />;
  }
}
