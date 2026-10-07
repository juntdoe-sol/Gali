'use dom';
/**
 * The canvas Cave Run is played on. A DOM component like the island: a plain
 * <canvas> on the web, a WebView on Android. The whole game loop and its touch
 * controls run inside it, so nothing waits on the bridge while you play.
 */
import { useEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { CaveEngine, type CaveEvent, type CaveOpts } from '../engine/cave';
import type { Look } from '../engine/types';

export interface CaveRef extends DOMImperativeFactory {
  opts: (...args: any[]) => void;
}

export default function CaveView({ ref, onEvent, atlas, look, opts }: { ref: Ref<CaveRef>; onEvent: (e: CaveEvent) => void; atlas: string; look: Look; opts: CaveOpts; dom?: DOMProps }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<CaveEngine | null>(null);

  useDOMImperativeHandle(ref, () => ({ opts: (o: any) => engine.current?.setOpts(o as Partial<CaveOpts>) }), []);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (typeof document !== 'undefined') {
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.background = '#0a0810';
    }
    const e = new CaveEngine(cv, (ev) => onEvent(ev), look, opts);
    engine.current = e;
    void e.start(atlas);
    return () => e.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvas}
      data-gali-cave="1"
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', touchAction: 'none', background: '#0a0810', userSelect: 'none' }}
    />
  );
}
