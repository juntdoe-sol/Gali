'use dom';
/**
 * The canvas the whole island is drawn on. A DOM component: on the web it is a
 * plain <canvas>, on Android Expo hosts it in a WebView, and the same engine
 * runs in both. The app talks to it with push/focus; it answers through onEvent.
 */
import { useEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { Engine } from '../engine/engine';
import type { EngineEvent, Snapshot } from '../engine/types';

export interface GameRef extends DOMImperativeFactory {
  push: (...args: any[]) => void;
  focus: (...args: any[]) => void;
}

export default function GameView({ ref, onEvent, atlas }: { ref: Ref<GameRef>; onEvent: (e: EngineEvent) => void; atlas: string; dom?: DOMProps }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const pending = useRef<Snapshot | null>(null);

  useDOMImperativeHandle(
    ref,
    () => ({
      push: (s: any) => {
        if (engine.current) engine.current.push(s as Snapshot);
        else pending.current = s as Snapshot;
      },
      focus: (i: any) => engine.current?.setFocus(Number(i)),
    }),
    [],
  );

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (typeof document !== 'undefined') {
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.background = '#123a6b';
    }
    const e = new Engine(cv, (ev) => onEvent(ev));
    engine.current = e;
    if (pending.current) e.push(pending.current);
    void e.start(atlas);
    return () => e.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvas}
      data-gali="1"
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', touchAction: 'none', background: '#123a6b' }}
    />
  );
}
