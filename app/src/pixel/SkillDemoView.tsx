'use dom';
/**
 * A Fight Club skill on loop, for the Market: the real fight engine (engine/brawlore.ts) in preview mode, two
 * miners, you using the skill on a sparring partner. No keys, no HUD. A plain <canvas> on the web, a WebView on Android.
 */
import { useEffect, useRef } from 'react';
import type { DOMProps } from 'expo/dom';
import { BrawlEngine } from '../engine/brawlore';
import type { SkillId } from '../game/brawl2/sim';

export default function SkillDemoView({ atlas, skill }: { atlas: string; skill: string; dom?: DOMProps }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<BrawlEngine | null>(null);
  const want = useRef(skill);
  want.current = skill;

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const e = new BrawlEngine(cv, () => undefined, false, true);
    engine.current = e;
    void e.start(atlas).then(() => e.demo(want.current as SkillId));
    return () => e.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.current?.demo(skill as SkillId);
  }, [skill]);

  return <canvas ref={canvas} style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block', imageRendering: 'pixelated', background: '#0b0712' }} />;
}
