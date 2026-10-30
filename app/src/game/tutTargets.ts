/**
 * Where the tutorial points: parts of the interface register themselves by name (`useTutTarget('deploy')`),
 * and while a tutorial is showing they report their place on screen, so the tutorial can draw a pointing hand
 * and a glow over the real button. Also carries the LITE amount, which lives inside the deploy panel.
 */
import { useEffect, useRef } from 'react';
import type { View } from 'react-native';
import { create } from 'zustand';

export type TutTargetId = 'tab-lite' | 'tab-pro' | 'amount' | 'quick' | 'pro-tiles' | 'deploy' | 'unclaimed' | 'tab-quests';
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const useTut = create<{
  /** a tutorial is on screen: targets keep measuring themselves */
  active: boolean;
  rects: Partial<Record<TutTargetId, Rect>>;
  /** SOL typed or added in LITE */
  liteAmount: number;
  /** when LITE's MAX was last pressed (ms) */
  maxAt: number;
  /** bump to empty LITE's amount box (the tutorial starts each lesson from 0) */
  clearAt: number;
  /** bump to open the Quests page (the tutorial's last step) */
  questsAt: number;
}>(() => ({ active: false, rects: {}, liteAmount: 0, maxAt: 0, clearAt: 0, questsAt: 0 }));

/** Give the returned ref to the view the tutorial may point at. */
export function useTutTarget(id: TutTargetId) {
  const ref = useRef<View>(null);
  const active = useTut((s) => s.active);
  useEffect(() => {
    if (!active) return;
    const measure = () =>
      ref.current?.measureInWindow?.((x, y, w, h) => {
        if (!w || !h) return;
        const prev = useTut.getState().rects[id];
        if (prev && prev.x === x && prev.y === y && prev.w === w && prev.h === h) return;
        useTut.setState((s) => ({ rects: { ...s.rects, [id]: { x, y, w, h } } }));
      });
    measure();
    const t = setInterval(measure, 400);
    return () => {
      clearInterval(t);
      useTut.setState((s) => {
        const rects = { ...s.rects };
        delete rects[id];
        return { rects };
      });
    };
  }, [active, id]);
  return ref;
}
