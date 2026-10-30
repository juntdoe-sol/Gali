/**
 * How big ORE's motherlode is right now, for highlighting it when it is worth chasing.
 * The cut-offs are Gali's own choice (not ORE figures): change them here.
 */
import { useEffect, useRef, useState } from 'react';

export const MOTHERLODE_BIG = 100; // ORE
export const MOTHERLODE_HUGE = 200; // ORE

export type LodeTier = 'normal' | 'big' | 'huge';
export const lodeTier = (ore: number): LodeTier => (ore >= MOTHERLODE_HUGE ? 'huge' : ore >= MOTHERLODE_BIG ? 'big' : 'normal');
export const LODE_WORD: Record<LodeTier, string> = { normal: '', big: 'BIG', huge: 'HUGE' };

/** The ORE added since the last change, shown for a moment each time the motherlode grows (0 when quiet). */
export function useLodeGrowth(ore: number, ms = 2200): number {
  const prev = useRef(ore);
  const [grew, setGrew] = useState(0);
  useEffect(() => {
    const d = ore - prev.current;
    prev.current = ore;
    if (!(d > 0.0001) || ore === d) return; // ignore the first read (0 -> value)
    setGrew(d);
    const id = setTimeout(() => setGrew(0), ms);
    return () => clearTimeout(id);
  }, [ore, ms]);
  return grew;
}
