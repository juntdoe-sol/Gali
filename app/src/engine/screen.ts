/**
 * Two browser facts every canvas engine needs.
 *
 * canvasDpr: how many device pixels to draw per CSS pixel. Pixel art gains nothing past about
 * 6 million drawn pixels, and a 4K monitor or a big retina window would otherwise ask for 15
 * million or more every frame, which is where laptops start to drop frames and heat up.
 *
 * reducedMotion: the player has asked their system for less motion, so screen shake stays off.
 */
const BUDGET = 6_000_000;

export function canvasDpr(cssW: number, cssH: number, cap: number): number {
  const want = Math.min((typeof window !== 'undefined' && window.devicePixelRatio) || 1, cap);
  const fit = Math.sqrt(BUDGET / Math.max(1, cssW * cssH));
  return Math.max(1, Math.min(want, fit));
}

let reduced: MediaQueryList | null = null;
export function reducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    reduced ??= window.matchMedia('(prefers-reduced-motion: reduce)');
    return reduced.matches;
  } catch {
    return false;
  }
}

/** How much one wheel event zooms: about 6% a mouse notch, smooth on a trackpad. */
export function wheelZoom(e: WheelEvent): number {
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  return Math.exp(-Math.max(-50, Math.min(50, px)) * 0.0012);
}
