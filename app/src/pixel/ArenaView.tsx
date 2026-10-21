'use dom';
/**
 * The canvas the arena is drawn on. A DOM component like the lobby and Cave Run: a plain <canvas> on the
 * web, a WebView on Android. Fighting, aiming and shards run inside it; the app sends the crowd and the
 * match, and reads back what you did.
 */
import { useEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { ArenaEngine, type ArenaEvent, type ArenaOpts, type ArenaSnap } from '../engine/arena';
import { zoneTouches } from './zoneTouch';
import type { Look } from '../engine/types';

export interface ArenaRef extends DOMImperativeFactory {
  /** where the app's game buttons sit (ui/zones.tsx), so a finger on one is pressed even mid-walk */
  zones: (...args: any[]) => void;
  push: (...args: any[]) => void;
  attack: (...args: any[]) => void;
  jump: (...args: any[]) => void;
  power: (...args: any[]) => void;
  throwOre: (...args: any[]) => void;
  mobDown: (...args: any[]) => void;
  grab: (...args: any[]) => void;
  emote: (...args: any[]) => void;
  opts: (...args: any[]) => void;
}

export default function ArenaView({ ref, onEvent, atlas, look, opts }: { ref: Ref<ArenaRef>; onEvent: (e: ArenaEvent) => void; atlas: string; look: Look; opts: ArenaOpts; dom?: DOMProps }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<ArenaEngine | null>(null);
  const zt = useRef<ReturnType<typeof zoneTouches> | null>(null);
  const zonesWas = useRef<unknown>(null);
  const pending = useRef<ArenaSnap | null>(null);

  useDOMImperativeHandle(
    ref,
    () => ({
      zones: (z: any) => {
        zonesWas.current = z;
        zt.current?.set(z);
      },
      push: (s: any) => {
        if (engine.current) engine.current.push(s as ArenaSnap);
        else pending.current = s as ArenaSnap;
      },
      attack: () => engine.current?.attack(),
      jump: () => engine.current?.jump(),
      power: (p: any) => engine.current?.power(String(p)),
      throwOre: () => engine.current?.throwOre(),
      mobDown: (x: any, mine: any) => engine.current?.mobDown(Number(x), Boolean(mine)),
      grab: () => engine.current?.grab(),
      emote: (i: any) => engine.current?.emote(Number(i)),
      opts: (o: any) => engine.current?.setOpts(o as Partial<ArenaOpts>),
    }),
    [],
  );

  useEffect(() => {
    engine.current?.setLook(look);
  }, [look.sex, look.hat, look.fit, look.pick, look.pet]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (typeof document !== 'undefined') {
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.background = '#120c1a';
    }
    const e = new ArenaEngine(cv, (ev) => onEvent(ev), look, opts);
    engine.current = e;
    if (pending.current) e.push(pending.current);
    void e.start(atlas);
    const z = zoneTouches((id) => onEvent({ t: 'zone', id } as never));
    z.set(zonesWas.current);
    zt.current = z;
    return () => {
      z.stop();
      e.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvas}
      data-gali-arena="1"
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', touchAction: 'none', background: '#120c1a', userSelect: 'none' }}
    />
  );
}
