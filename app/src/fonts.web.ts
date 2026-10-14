// Web: the same fonts, subset to the characters the game uses and compressed to
// WOFF2 (33 KB for all five). public/index.html declares and preloads them; this
// waits until they are ready, or gives up after two seconds and lets the system
// font stand in rather than hold the interface back.
import { useEffect, useState } from 'react';

const FAMILIES = ['Jersey15_400Regular', 'PixelifySans_400Regular', 'PixelifySans_600SemiBold', 'PixelifySans_700Bold', 'Silkscreen_400Regular'];

export function useAppFonts(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts || typeof fonts.load !== 'function') return setOk(true);
    const done = () => setOk(true);
    const t = setTimeout(done, 2000);
    Promise.all(FAMILIES.map((f) => fonts.load(`16px "${f}"`)))
      .then(done, done)
      .finally(() => clearTimeout(t));
    return () => clearTimeout(t);
  }, []);
  return ok;
}
