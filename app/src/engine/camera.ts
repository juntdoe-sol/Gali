/**
 * The camera over the island: where it looks (map pixels at the centre of the
 * view) and how close (CSS pixels per map pixel). It fits the island between the
 * HUD and the dock by default, pinches in to four times that, and flies.
 */
import { ISLE } from './art';

const [FX, FY, FW, FH] = ISLE.fit as [number, number, number, number];
const [MAPW, MAPH] = ISLE.size as [number, number];
/** how far out a pinch may go: the whole wider map, not only the default frame */
const ZOOM_OUT = 0.5;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class Camera {
  cx = FX + FW / 2;
  cy = FY + FH / 2;
  z = 1;
  fitZ = 1;
  /** the band of screen the island may use, CSS px */
  vx = 0;
  vy = 0;
  vw = 1;
  vh = 1;
  private fly: { t0: number; ms: number; a: [number, number, number]; b: [number, number, number] } | null = null;
  userZoomed = false;
  /** keep the current framing (a punch-in on the winner) instead of easing back to fit */
  hold = false;
  /** the camera trails the miner once they walk out of the default frame, like the lobby does */
  follow = false;
  private focus: [number, number] = [FX + FW / 2, FY + FH / 2];
  /** a pinch or drag by hand pauses the follow until this time (ms, performance clock) */
  manualUntil = 0;

  setView(x: number, y: number, w: number, h: number) {
    const fit = Math.min(w / FW, h / FH);
    const wasFit = !this.userZoomed && !this.fly && !this.hold && !this.follow && !this.manual;
    this.vx = x;
    this.vy = y;
    this.vw = w;
    this.vh = h;
    this.fitZ = fit;
    if (wasFit) {
      // ease toward the new fit rather than jump when the dock opens or closes
      this.z += (fit - this.z) * 0.3;
      if (Math.abs(fit - this.z) < 0.002) this.z = fit;
      this.cx += (FX + FW / 2 - this.cx) * 0.3;
      this.cy += (FY + FH / 2 - this.cy) * 0.3;
    }
  }

  get flying() {
    return this.fly !== null;
  }

  /** where the camera should be looking while it follows */
  setFocus(x: number, y: number) {
    this.focus = [x, y];
  }
  get manual() {
    return performance.now() < this.manualUntil;
  }

  flyTo(cx: number, cy: number, z: number, ms: number) {
    this.follow = false;
    this.fly = { t0: performance.now(), ms, a: [this.cx, this.cy, this.z], b: [cx, cy, z] };
  }
  home(ms = 420) {
    this.follow = false;
    this.userZoomed = false;
    this.hold = false;
    this.flyTo(FX + FW / 2, FY + FH / 2, this.fitZ, ms);
  }

  update(now: number) {
    if (this.follow && !this.fly) {
      this.cx += (this.focus[0] - this.cx) * 0.14;
      this.cy += (this.focus[1] - this.cy) * 0.14;
      this.clamp();
      return;
    }
    if (!this.fly) return;
    const { t0, ms, a, b } = this.fly;
    const k = Math.min(1, (now - t0) / ms);
    const e = ease(k);
    // zoom interpolates in log space so the fly-in feels even
    this.z = Math.exp(Math.log(a[2]) + (Math.log(b[2]) - Math.log(a[2])) * e);
    this.cx = a[0] + (b[0] - a[0]) * e;
    this.cy = a[1] + (b[1] - a[1]) * e;
    if (k >= 1) this.fly = null;
  }
  flyProgress(now: number) {
    return this.fly ? Math.min(1, (now - this.fly.t0) / this.fly.ms) : 1;
  }

  /** Zoom by `k` keeping map point under screen (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, k: number) {
    const [mx, my] = this.toMap(sx, sy);
    const nz = Math.max(this.fitZ * ZOOM_OUT, Math.min(this.fitZ * 4, this.z * k));
    this.z = nz;
    this.manualUntil = performance.now() + 4000;
    this.follow = false;
    const [nx, ny] = this.toMap(sx, sy);
    this.cx += mx - nx;
    this.cy += my - ny;
    this.userZoomed = nz > this.fitZ * 1.02 || nz < this.fitZ * 0.98;
    this.clamp();
  }
  pan(dx: number, dy: number) {
    this.manualUntil = performance.now() + 4000;
    this.follow = false;
    this.cx -= dx / this.z;
    this.cy -= dy / this.z;
    this.clamp();
  }
  clamp() {
    // keep some of the map in view however far you drag or follow
    const hw = this.vw / 2 / this.z;
    const hh = this.vh / 2 / this.z;
    const minX = Math.min(hw, MAPW / 2);
    const maxX = MAPW - minX;
    const minY = Math.min(hh, MAPH / 2);
    const maxY = MAPH - minY;
    this.cx = Math.max(minX, Math.min(maxX, this.cx));
    this.cy = Math.max(minY, Math.min(maxY, this.cy));
    // at the default zoom, with nothing following, the frame is the island's own
    if (!this.follow && !this.manual && Math.abs(this.z - this.fitZ) <= this.fitZ * 0.001) {
      this.cx = FX + FW / 2;
      this.cy = FY + FH / 2;
    }
  }

  /** Screen CSS px of the map origin. */
  get ox() {
    return this.vx + this.vw / 2 - this.cx * this.z;
  }
  get oy() {
    return this.vy + this.vh / 2 - this.cy * this.z;
  }
  toMap(sx: number, sy: number): [number, number] {
    return [(sx - this.ox) / this.z, (sy - this.oy) / this.z];
  }
  toScreen(mx: number, my: number): [number, number] {
    return [this.ox + mx * this.z, this.oy + my * this.z];
  }
}
