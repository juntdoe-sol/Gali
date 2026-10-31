'use dom';
/**
 * The BrawlOre canvas. A DOM component like the arena and Cave Run: a plain <canvas> on the web, a WebView on
 * Android. The whole fight (and its phone controls) runs inside it; the app starts matches and hears the results.
 */
import { useEffect, useRef, type Ref } from 'react';
import { useDOMImperativeHandle, type DOMImperativeFactory, type DOMProps } from 'expo/dom';
import { BrawlEngine, type BrawlEvent, type BrawlSetup } from '../engine/brawlore';

export interface BrawlOreRef extends DOMImperativeFactory {
  begin: (...args: any[]) => void;
  quit: (...args: any[]) => void;
}

export default function BrawlOreView({ ref, onEvent, atlas, touch }: { ref: Ref<BrawlOreRef>; onEvent: (e: BrawlEvent) => void; atlas: string; touch: boolean; dom?: DOMProps }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<BrawlEngine | null>(null);
  const pending = useRef<BrawlSetup | null>(null);

  useDOMImperativeHandle(
    ref,
    () => ({
      begin: (s: any) => {
        if (engine.current) engine.current.begin(s as BrawlSetup);
        else pending.current = s as BrawlSetup;
      },
      quit: () => engine.current?.quit(),
    }),
    [],
  );

  useEffect(() => {
    engine.current?.setTouch(touch);
  }, [touch]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    if (typeof document !== 'undefined') {
      document.body.style.margin = '0';
      document.body.style.overflow = 'hidden';
      document.body.style.background = '#0b0712';
    }
    const e = new BrawlEngine(cv, (ev) => onEvent(ev), touch);
    engine.current = e;
    void e.start(atlas).then(() => {
      if (pending.current) e.begin(pending.current);
      pending.current = null;
    });
    return () => e.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvas}
      data-gali-brawlore="1"
      style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', touchAction: 'none', background: '#0b0712', userSelect: 'none' }}
    />
  );
}
