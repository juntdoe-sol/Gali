'use dom';
/**
 * The canvas the lobby is drawn on. A DOM component like the island and Cave Run: a plain
 * <canvas> on the web, a WebView on Android. The walking, the crowd and the touch
 * controls all run inside it; the app only sends the other players and reads back where you are.
 */
import { useEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { LobbyEngine, type LobbyEvent, type LobbyOpts, type LobbySnap } from '../engine/lobby';
import type { Look } from '../engine/types';

export interface LobbyRef extends DOMImperativeFactory {
  push: (...args: any[]) => void;
  goTo: (...args: any[]) => void;
  opts: (...args: any[]) => void;
}

export default function LobbyView({ ref, onEvent, atlas, look, opts }: { ref: Ref<LobbyRef>; onEvent: (e: LobbyEvent) => void; atlas: string; look: Look; opts: LobbyOpts; dom?: DOMProps }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<LobbyEngine | null>(null);
  const pending = useRef<LobbySnap | null>(null);

  useDOMImperativeHandle(
    ref,
    () => ({
      push: (s: any) => {
        if (engine.current) engine.current.push(s as LobbySnap);
        else pending.current = s as LobbySnap;
      },
      goTo: (id: any) => engine.current?.goTo(String(id) as never),
      opts: (o: any) => engine.current?.setOpts(o as Partial<LobbyOpts>),
    }),
    [],
  );

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (typeof document !== 'undefined') {
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.background = '#2f7fc4';
    }
    const e = new LobbyEngine(cv, (ev) => onEvent(ev), look, opts);
    engine.current = e;
    if (pending.current) e.push(pending.current);
    void e.start(atlas);
    return () => e.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvas}
      data-gali-lobby="1"
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', touchAction: 'none', background: '#2f7fc4', userSelect: 'none' }}
    />
  );
}
