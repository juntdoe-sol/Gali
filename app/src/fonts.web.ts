// Web: the same fonts, subset to the characters the game uses and compressed to
// WOFF2 (318 KB of TTF down to 41 KB). public/index.html declares and preloads
// them; this waits until they are ready, or gives up after two seconds and lets
// the system font stand in rather than hold the interface back.
import { useEffect, useState } from 'react';

const FAMILIES = ['Jersey15_400Regular', 'ChakraPetch_500Medium', 'ChakraPetch_600SemiBold', 'ChakraPetch_700Bold'];

export function useAppFonts(): boolean {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) return setOk(true);
    const done = () => setOk(true);
    const t = setTimeout(done, 2000);
    Promise.all(FAMILIES.map((f) => fonts.load(`16px "${f}"`)))
      .then(done, done)
      .finally(() => clearTimeout(t));
    return () => clearTimeout(t);
  }, []);
  return ok;
}
