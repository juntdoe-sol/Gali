/**
 * Which shape of interface to draw.
 *
 * phone:   one column, bottom bar, sheets slide up. Every phone, and a narrow browser window.
 * tablet:  the phone layout with its panels held to a readable width and centred.
 * desktop: a wide window. Navigation moves to a rail on the left, the round and the deploy
 *          controls sit in a panel on the right, and pages open as windows beside the rail.
 *
 * `mouse` is separate from size: a big touchscreen keeps the joystick and loses the key hints.
 */
import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

export type Shape = 'phone' | 'tablet' | 'desktop';

/** Desktop rail width, side panel width and the top bar height, in CSS px. */
export const RAIL_W = 88;
export const TOP_H = 64;
export const GUTTER = 14;
export const sideWidth = (w: number) => (w >= 1500 ? 400 : w >= 1280 ? 372 : 340);
/** Phone panels never grow wider than this on a tablet. */
export const COLUMN_MAX = 560;

export const shapeOf = (w: number, h: number): Shape => (w >= 1000 && h >= 560 ? 'desktop' : w >= 700 ? 'tablet' : 'phone');

function readMouse(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  } catch {
    return false;
  }
}

/** True once a mouse or trackpad is the main pointer. Updates if one is plugged in or unplugged. */
export function useMouse(): boolean {
  const [m, setM] = useState(readMouse);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const q = window.matchMedia('(hover: hover) and (pointer: fine)');
    const on = () => setM(q.matches);
    // Safari before 14 only has addListener
    if (q.addEventListener) q.addEventListener('change', on);
    else q.addListener?.(on);
    return () => {
      if (q.removeEventListener) q.removeEventListener('change', on);
      else q.removeListener?.(on);
    };
  }, []);
  return m;
}

export interface Layout {
  shape: Shape;
  desktop: boolean;
  w: number;
  h: number;
  mouse: boolean;
  /** desktop side panel width, 0 elsewhere */
  side: number;
  /** desktop rail width, 0 elsewhere */
  rail: number;
}

export function useLayout(): Layout {
  const { width: w, height: h } = useWindowDimensions();
  const mouse = useMouse();
  // the Android app keeps its tested phone layout whatever the screen; the wide layouts are web only
  const shape = Platform.OS === 'web' ? shapeOf(w, h) : 'phone';
  const desktop = shape === 'desktop';
  return { shape, desktop, w, h, mouse, side: desktop ? sideWidth(w) : 0, rail: desktop ? RAIL_W : 0 };
}

/** The same answer outside React (the engine snapshot reads it every tick). */
export function layoutNow(): { desktop: boolean; side: number; rail: number; mouse: boolean } {
  if (typeof window === 'undefined') return { desktop: false, side: 0, rail: 0, mouse: false };
  const w = window.innerWidth;
  const desktop = Platform.OS === 'web' && shapeOf(w, window.innerHeight) === 'desktop';
  return { desktop, side: desktop ? sideWidth(w) : 0, rail: desktop ? RAIL_W : 0, mouse: readMouse() };
}

/**
 * Where floating interface may sit over the map: the edges of the play area.
 * Phone: inside the safe area, above the bottom bar. Desktop: between the rail and the side panel, under the top bar.
 */
export function useChrome(insets: { top: number; bottom: number }, barH = 64) {
  const L = useLayout();
  if (L.desktop) return { ...L, top: TOP_H + GUTTER, bottom: GUTTER, left: RAIL_W + GUTTER, right: L.side + GUTTER * 2 };
  return { ...L, top: insets.top + 8, bottom: insets.bottom + barH, left: 12, right: 12 };
}
