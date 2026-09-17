import * as THREE from 'three';

// 3-step ramp for a cel-shaded cartoon look.
const data = new Uint8Array([60, 60, 60, 255, 150, 150, 150, 255, 255, 255, 255, 255]);
export const toonRamp = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
toonRamp.minFilter = THREE.NearestFilter;
toonRamp.magFilter = THREE.NearestFilter;
toonRamp.needsUpdate = true;

export const INK = '#0a1024';

export function Toon({ c, e, ei = 0 }: { c: string; e?: string; ei?: number }) {
  return <meshToonMaterial color={c} gradientMap={toonRamp} emissive={e ?? '#000000'} emissiveIntensity={ei} />;
}
