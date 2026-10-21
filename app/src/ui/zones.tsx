/**
 * Game buttons that work while another finger holds the stick, on Android.
 *
 * Android hands every extra finger to the view the first finger is on. With a thumb on the stick, that is
 * the game's WebView, so a button drawn by the app over it never hears the second thumb. Here each game
 * button (HIT, JUMP, the arena's powers) lets touches fall through to the game, and tells it where it sits.
 * The game catches a finger on that spot (pixel/zoneTouch.ts) and calls back here, which presses it.
 * On the web nothing changes: the buttons take their own clicks as before.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Platform, View, type ViewStyle } from 'react-native';
import { create } from 'zustand';
import { haptic } from '../game/sfx';
import type { ZoneRect } from '../pixel/zoneTouch';

export type ZoneGroup = 'lobby' | 'island' | 'arena';
/** Android; on the web only in its test mode (?zones=1), where it can be tried with two fingers in a browser */
export const ZONES_ON = Platform.OS === 'android' || (Platform.OS === 'web' && typeof window !== 'undefined' && /[?&]zones=1\b/.test(window.location?.search ?? ''));

interface Entry {
  group: ZoneGroup;
  rect: { x: number; y: number; w: number; h: number } | null;
  press: () => void;
  off: boolean;
}
const entries = new Map<string, Entry>();
let seq = 0;
/** bumps whenever a button is added, moves or goes */
const useZoneRev = create<{ v: number }>(() => ({ v: 0 }));
const bump = () => useZoneRev.setState((s) => ({ v: s.v + 1 }));

/** A finger landed on a button's spot in the game: press it. */
export function pressZone(id: unknown) {
  const e = entries.get(String(id));
  if (!e || e.off) return;
  haptic.tap();
  e.press();
}

/** Is this game event a button press caught by the game? Then press it and say so. */
export function zoneEvent(ev: unknown): boolean {
  const e = ev as { t?: string; id?: string } | null;
  if (!e || e.t !== 'zone') return false;
  pressZone(e.id);
  return true;
}

/** Measure a view in the window, as a promise. */
const measure = (v: View | null) =>
  new Promise<{ x: number; y: number; w: number; h: number } | null>((res) => {
    if (!v || typeof (v as unknown as { measureInWindow?: unknown }).measureInWindow !== 'function') return res(null);
    v.measureInWindow((x, y, w, h) => res(Number.isFinite(x) && w > 0 && h > 0 ? { x, y, w, h } : null));
  });

/**
 * A game button's spot. On Android its children see no touches (they fall through to the game, which sends
 * them back as presses); `children` gets a short "pressed" flash for the button's look. Anywhere else, or
 * with no group, it just draws the children, which take their own presses.
 */
export function TouchZone({ group, onPress, off, style, children }: { group?: ZoneGroup; onPress: () => void; off?: boolean; style?: ViewStyle; children: (pressed: boolean) => ReactNode }) {
  const on = ZONES_ON && Boolean(group);
  const view = useRef<View>(null);
  const id = useRef('');
  const [flash, setFlash] = useState(false);
  const press = useRef(onPress);
  press.current = onPress;

  const remeasure = useCallback(() => {
    void measure(view.current).then((r) => {
      const e = entries.get(id.current);
      if (!e) return;
      const same = e.rect && r && Math.abs(e.rect.x - r.x) < 1 && Math.abs(e.rect.y - r.y) < 1 && Math.abs(e.rect.w - r.w) < 1 && Math.abs(e.rect.h - r.h) < 1;
      if (same || (!e.rect && !r)) return;
      e.rect = r;
      bump();
    });
  }, []);

  useEffect(() => {
    if (!on || !group) return;
    const key = `z${++seq}`;
    id.current = key;
    let t: ReturnType<typeof setTimeout> | null = null;
    entries.set(key, {
      group,
      rect: null,
      off: Boolean(off),
      press: () => {
        press.current();
        setFlash(true);
        if (t) clearTimeout(t);
        t = setTimeout(() => setFlash(false), 140);
      },
    });
    bump();
    // the screen around a button can move without the button's own layout changing: look again now and then
    const iv = setInterval(remeasure, 1500);
    return () => {
      clearInterval(iv);
      if (t) clearTimeout(t);
      entries.delete(key);
      bump();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, group]);

  useEffect(() => {
    const e = entries.get(id.current);
    if (e && e.off !== Boolean(off)) {
      e.off = Boolean(off);
      bump();
    }
  }, [off]);

  if (!on) return <>{children(false)}</>;
  return (
    <View ref={view} collapsable={false} style={style} pointerEvents="none" onLayout={remeasure}>
      {children(flash)}
    </View>
  );
}

/**
 * For a screen with a game view: a ref for the view that holds the game, and `push`, which sends the
 * game the spots of this group's buttons, measured from that view's corner, whenever they change.
 */
export function useDomZones(group: ZoneGroup, send: (z: ZoneRect[]) => void) {
  const wrap = useRef<View>(null);
  const rev = useZoneRev((s) => s.v);
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  const sendRef = useRef(send);
  sendRef.current = send;
  const look = useCallback(() => {
    void measure(wrap.current).then((r) => {
      if (!r) return;
      setOrigin((o) => (o && Math.abs(o.x - r.x) < 1 && Math.abs(o.y - r.y) < 1 ? o : { x: r.x, y: r.y }));
    });
  }, []);
  useEffect(() => {
    if (!ZONES_ON) return;
    look();
    const iv = setInterval(look, 1500);
    return () => clearInterval(iv);
  }, [look]);
  // the game view can mount after the buttons: send again a moment later as well
  useEffect(() => {
    if (!ZONES_ON || !origin) return;
    const list: ZoneRect[] = [];
    for (const [id, e] of entries) {
      // a locked button still keeps its spot: a finger on it should not fall through to the game
      if (e.group !== group || !e.rect) continue;
      list.push({ id, x: e.rect.x - origin.x, y: e.rect.y - origin.y, w: e.rect.w, h: e.rect.h });
    }
    sendRef.current(list);
    const again = setTimeout(() => sendRef.current(list), 800);
    return () => clearTimeout(again);
  }, [rev, origin, group]);
  return { wrap, onLayout: look };
}
