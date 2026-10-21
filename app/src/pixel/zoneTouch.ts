/**
 * Runs inside a game's WebView. On Android, once one finger holds the game screen (the stick), every
 * other finger is handed to the same WebView, so the app's own buttons never hear it. The app sends the
 * spots its buttons sit on (ui/zones.ts), and a finger that lands on one is caught here, before the
 * game sees it, and sent back to the app as a press of that button.
 */
export interface ZoneRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** a little extra round each button: a thumb is wide */
const PAD = 6;

export function zoneTouches(onZone: (id: string) => void) {
  let zones: ZoneRect[] = [];
  const owned = new Set<number>();
  const hit = (x: number, y: number) => {
    // the last zone sent is drawn on top, so look from the end
    for (let i = zones.length - 1; i >= 0; i--) {
      const z = zones[i];
      if (x >= z.x - PAD && x <= z.x + z.w + PAD && y >= z.y - PAD && y <= z.y + z.h + PAD) return z;
    }
    return null;
  };
  const down = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !zones.length) return;
    const z = hit(e.clientX, e.clientY);
    if (!z) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    owned.add(e.pointerId);
    onZone(z.id);
  };
  const follow = (e: PointerEvent) => {
    if (!owned.has(e.pointerId)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    if (e.type === 'pointerup' || e.type === 'pointercancel') owned.delete(e.pointerId);
  };
  const off: (() => void)[] = [];
  if (typeof window !== 'undefined') {
    // capture on the window: heard before the canvas, so the game never sees a button press as a tap or a stick
    const opt = { capture: true, passive: false } as AddEventListenerOptions;
    window.addEventListener('pointerdown', down, opt);
    off.push(() => window.removeEventListener('pointerdown', down, opt));
    for (const t of ['pointermove', 'pointerup', 'pointercancel'] as const) {
      window.addEventListener(t, follow, opt);
      off.push(() => window.removeEventListener(t, follow, opt));
    }
  }
  return {
    set(z: unknown) {
      zones = Array.isArray(z) ? (z as ZoneRect[]).filter((r) => r && typeof r.id === 'string') : [];
    },
    stop() {
      off.forEach((f) => f());
      owned.clear();
    },
  };
}
